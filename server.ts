import express from "express";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { webhookQueue } from "./queue.js";
import { setupSwagger } from "./swagger.js";
import { getDepartmentForCategory, classifyProductTaxonomy, classifyProductCategory, OFFICIAL_DEPARTMENTS, OFFICIAL_TAXONOMY } from "./lib/departments.js";
import multer from "multer";
import * as XLSX from "xlsx";

import { checkTenantAccess } from "./checkTenantAccess.js";
import { calculateDeliveryDistance } from "./lib/maps.js";

import { dispatcher } from "./services/asyncDispatcher.js";
import { whatsappHealthManager } from "./services/whatsappHealthManager.js";
import { realtimeHub } from "./services/realtimeHub.js";
import { botHandoffManager, isWeblojaOrderMessage, isBotSentOrEcho, registerBotSentMessage, botSentMessageIds, detectHumanHandoffIntent, detectAiOutputHandoffIntent } from "./services/botHandoffManager.js";
import { continuousUseRefillManager } from "./services/continuousUseRefillManager.js";
import { csatManager } from "./services/csatManager.js";
import { contactMergeManager } from "./services/contactMergeManager.js";
import { inboxStore } from "./services/inboxStore.js";
import { chatStore } from "./services/chatStore.js";
import { teamStore } from "./services/teamStore.js";
import { aiAgentService, DEFAULT_AI_AGENT_PROMPT, isolateUrlsInText, extractUrlAndCleanText, ensureStoreUrlCacheBuster, formatToWhatsAppMarkdown, cleanSearchInterjections, PHARMA_EXPANSIONS, extractProductSize, productMatchesSize } from "./services/aiAgentService.js";
import {
  evolutionApiService,
  safeUpdateWhatsappInstance,
  syncStoreInboxesToConnectedInstance,
  isValidUuid,
  isExclusiveInstanceName,
  resolveStoreCandidateIds,
} from "./services/evolutionApiService.js";
import { transcribeAudio } from "./services/audioAiService.js";
import ogHandler, { buildCrawlerHtml, isCrawlerRequest } from "./api/og-handler.js";
import QRCode from "qrcode";
import {
  fetchAndStoreProductImageByEan,
  syncEanImagesBatch,
  validateAndCleanEan,
  cleanupCorruptedEanImages,
  isGenericMedicationProduct,
  isPlaceholderImageUrl,
} from "./services/eanImageService.js";
import {
  syncInovafarmaProductsToSupabase,
  normalizeInovafarmaProduct,
  resolveProductPriceDivisor,
  isSingleUnitRetailProduct,
  ProductPriceDivisorRule,
  sanitizeInovafarmaEan,
  parseInovafarmaNumber,
  INOVAFARMA_DEFAULT_API_URL,
  INOVAFARMA_DEFAULT_ROUTE_ID,
  INOVAFARMA_HOMOLOGACAO_PRESET,
  checkInovafarmaServerConnectivity,
  fetchInovafarmaProducts,
  fetchInovafarmaProdutosAlterados,
  fetchInovafarmaClientes,
  fetchInovafarmaClientesAlterados,
  fetchInovafarmaFuncionarios,
  fetchInovafarmaMetodosPagamentos,
  fetchInovafarmaVendaPorId,
  reconcilePendingInovafarmaOrders,
  buildInovafarmaVendaPayload,
  sendInovafarmaVenda,
  sanitizeCnpj,
  resolveEffectiveInovafarmaCnpj,
  roundCurrency,
  authenticateInovafarma,
  resolveTenantInovafarmaToken,
  encryptErpPassword,
  decryptErpPassword,
  isMaskedErpPassword,
  extractTenantErpConfig,
  parseInovafarmaUrlAndRoute,
  extractTenantErpLogin,
  extractTenantErpPassword,
  hasTenantErpPassword,
  saveTenantInovafarmaState,
  touchInovafarmaHeartbeat,
  isCachedInovafarmaTokenValid,
  deriveInovafarmaDateRange,
  sanitizeTenantErpCredentialsForClient,
} from "./services/inovafarma.js";
import {
  ensurePushSubscriptionsTable,
  getOrInitVapidKeys,
  resolveTenantIdsByEndpoint,
  removePushSubscriptionByEndpoint,
  savePushSubscription,
  getTenantPushSubscriptions,
  verifyPushSubscriptionExists,
  sendPromotionalPushToTenant,
  isValidRealPushEndpoint,
} from "./services/webPushService.js";



// Permitir conexões com instâncias auto-hospedadas / certificados personalizados da Evolution API
if (typeof process !== "undefined" && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Supabase Client for Server-side operations
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Dedicated client for Supabase administrative actions (Service Role)
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

app.use(compression());
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ============================================================================
// INTERCEPTAÇÃO DO CRAWLER DE OPEN GRAPH (WhatsApp, Facebook, Twitter, LinkedIn)
// ============================================================================
const DEFAULT_FALLBACK_OG_LOGO = 'https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_og_1794391014029.jpg';

function detectOgImageType(url: string = ''): string {
  const lower = String(url || '').toLowerCase().split('?')[0];
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/png';
}

app.use(async (req, res, next) => {
  // Ignora rotas de API internas (exceto /api/og) e arquivos estáticos (js, css, imagens, etc.)
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/og')) return next();
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff|woff2|ttf|map)$/i.test(req.path)) return next();

  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = /facebookexternalhit|whatsapp|meta-externalagent|meta-externalfetcher|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview|baileys|evolution/i.test(userAgent);

  if (!isBot) {
    return next();
  }

  try {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(':')[0].toLowerCase();

    // 1. Identificar identificador da drogaria / subdomínio
    let identifier = (req.query?.store || req.query?.loja || req.query?.tenant || req.query?.slug || req.query?.id || '').toString().trim();

    if (!identifier && host.includes('.')) {
      const parts = host.split('.');
      if (
        parts[0] !== 'www' &&
        parts[0] !== 'farmaflow' &&
        parts[0] !== 'nexoia' &&
        parts[0] !== 'app' &&
        parts[0] !== 'admin' &&
        parts[0] !== 'api' &&
        parts[0] !== 'portal' &&
        parts[0] !== 'localhost'
      ) {
        identifier = parts[0];
      }
    }

    if (!identifier && req.path) {
      const match = req.path.match(/(?:\/loja|\/store)\/([^\/?#]+)/i);
      if (match && match[1]) {
        identifier = decodeURIComponent(match[1]).trim();
      }
    }

    if (!identifier) {
      identifier = 'drogaria-esplendido';
    }

    // 2. Consulta à drogaria no Supabase utilizando SUPABASE_SERVICE_ROLE_KEY (supabaseAdmin) para contornar RLS
    let tenant: any = null;
    const cleanIdentifier = identifier.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

    // Busca direta por ID ou Slug
    try {
      const { data } = await supabaseAdmin
        .from('tenants')
        .select('*')
        .or(`id.eq.${identifier},slug.eq.${identifier}`)
        .maybeSingle();

      if (data) {
        tenant = data;
      }
    } catch (_) {}

    // Busca ampla com normalização e tolerância fonética/ortográfica
    if (!tenant) {
      try {
        const { data: allTenants } = await supabaseAdmin
          .from('tenants')
          .select('*');

        if (allTenants && allTenants.length > 0) {
          tenant = allTenants.find((t: any) => {
            const s = (t.slug || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const i = (t.id || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const n = (t.name || t.nome_loja || t.razao_social || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const tn = (t.trade_name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const c = (t.custom_domain || '').toLowerCase().trim();

            if (s === cleanIdentifier || i === cleanIdentifier || n === cleanIdentifier || tn === cleanIdentifier || c === identifier.toLowerCase().trim()) return true;
            if (cleanIdentifier.replace(/x/g, 's') === s.replace(/x/g, 's') || cleanIdentifier.replace(/x/g, 's') === n.replace(/x/g, 's') || cleanIdentifier.replace(/x/g, 's') === tn.replace(/x/g, 's')) return true;
            return false;
          }) || null;
        }
      } catch (_) {}
    }

    if (!tenant) {
      tenant = {
        name: 'Drogaria Explendido',
        trade_name: 'Drogaria Explendido',
        logo_url: DEFAULT_FALLBACK_OG_LOGO
      };
    }

    const proto = (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'https')).toString();
    const currentHost = (!host || host === 'localhost' || host === '127.0.0.1') ? 'drogaria-esplendido.farmaflow.online' : host;
    const currentUrl = `${proto}://${currentHost}${req.originalUrl || req.url || '/'}`;

    const title = tenant.trade_name || tenant.name || tenant.razao_social || 'Drogaria Explendido';
    const description = `Faça seu pedido online com rapidez e comodidade na ${tenant.trade_name || 'nossa drogaria'}.`;
    let logoUrl = (tenant.logo_url || tenant.logo || tenant.smart_banners?._regulatoryData?.logo_url || DEFAULT_FALLBACK_OG_LOGO).trim();
    if (logoUrl.startsWith('http://')) {
      logoUrl = logoUrl.replace('http://', 'https://');
    }
    if (!logoUrl.startsWith('https://')) {
      logoUrl = DEFAULT_FALLBACK_OG_LOGO;
    }
    const imageType = detectOgImageType(logoUrl);

    console.log(`[CRAWLER_OG] 🤖 Scraper detectado (${userAgent.substring(0, 30)}...). Retornando meta tags para "${title}": logo=${logoUrl} (${imageType})`);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${title}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:image:alt" content="${title}" />
  <meta property="og:url" content="${currentUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${logoUrl}" />
  <link rel="icon" href="${logoUrl}" />
  <link rel="apple-touch-icon" href="${logoUrl}" />
</head>
<body></body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (crawlerErr) {
    console.error('[CRAWLER_OG] Erro ao servir meta tags para crawler:', crawlerErr);
    return next();
  }
});

// ============================================================================
// ROTA DEDICADA DE OPEN GRAPH COM REDIRECIONAMENTO INSTANTÂNEO (/s/:slug)
// Evita cache estático do SPA e garante Link Preview rico para o WhatsApp e Baileys
// ============================================================================
const handleSharePreviewRoute = async (req: express.Request, res: express.Response) => {
  try {
    const paramSlug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const rawSlug = String(paramSlug || req.query?.slug || req.query?.store || '').trim();
    const cleanSlug = (rawSlug || 'drogaria-esplendido')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]/g, '');

    let tenant: any = null;

    // 1. Buscar a drogaria no Supabase pelo id ou slug usando SUPABASE_SERVICE_ROLE_KEY (supabaseAdmin)
    try {
      const { data } = await supabaseAdmin
        .from('tenants')
        .select('*')
        .or(`id.eq.${cleanSlug},slug.eq.${cleanSlug},slug.ilike.%${cleanSlug}%`)
        .limit(1)
        .maybeSingle();

      if (data) {
        tenant = data;
      }
    } catch (_) {}

    // Busca ampla de tolerância se não encontrar diretamente
    if (!tenant) {
      try {
        const { data: allTenants } = await supabaseAdmin
          .from('tenants')
          .select('*');
        if (allTenants && allTenants.length > 0) {
          const norm = cleanSlug.replace(/-/g, '').replace(/x/g, 's');
          tenant = allTenants.find((t: any) => {
            const i = (t.id || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/x/g, 's');
            const s = (t.slug || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/x/g, 's');
            const n = (t.trade_name || t.name || t.razao_social || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/x/g, 's');
            if (i && (i === norm || i.includes(norm) || norm.includes(i))) return true;
            if (s && (s === norm || s.includes(norm) || norm.includes(s))) return true;
            if (n && (n === norm || n.includes(norm))) return true;
            return false;
          });
        }
      } catch (_) {}
    }

    const storeName = tenant?.trade_name || tenant?.name || tenant?.razao_social || 'Drogaria Explendido';
    let logoUrl = (tenant?.logo_url || tenant?.logo || tenant?.smart_banners?._regulatoryData?.logo_url || '').trim();
    if (logoUrl.startsWith('http://')) {
      logoUrl = logoUrl.replace('http://', 'https://');
    }
    if (!logoUrl.startsWith('https://')) {
      logoUrl = DEFAULT_FALLBACK_OG_LOGO;
    }
    const imageType = detectOgImageType(logoUrl);

    const baseDomain = tenant?.slug || tenant?.id || cleanSlug || 'drogaria-esplendido';
    const prodSlug = req.query?.p || req.query?.produto;
    let targetUrl = tenant?.custom_domain 
      ? `https://${tenant.custom_domain.replace(/^https?:\/\//, '')}` 
      : `https://${baseDomain}.farmaflow.online`;

    if (prodSlug) {
      targetUrl = `${targetUrl}/produto/${encodeURIComponent(String(prodSlug))}`;
    }

    // 2. Definir headers anti-cache absolutos
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 3. Devolver HTML com as tags Open Graph ricas e redirecionamento instantâneo para o cliente:
    return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${storeName}</title>
  <meta name="description" content="Faça seu pedido online com rapidez e comodidade na ${storeName}." />
  
  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${storeName}" />
  <meta property="og:title" content="${storeName}" />
  <meta property="og:description" content="Faça seu pedido online com rapidez e comodidade na nossa drogaria." />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:image:alt" content="${storeName}" />
  <meta property="og:url" content="${targetUrl}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${storeName}" />
  <meta name="twitter:description" content="Faça seu pedido online com rapidez e comodidade na nossa drogaria." />
  <meta name="twitter:image" content="${logoUrl}" />

  <link rel="icon" href="${logoUrl}" />
  <link rel="apple-touch-icon" href="${logoUrl}" />

  <!-- Redirecionamento instantâneo se um usuário humano abrir -->
  <meta http-equiv="refresh" content="0;url=${targetUrl}" />
  <script>window.location.replace("${targetUrl}");</script>
</head>
<body>
  <p>Redirecionando para <a href="${targetUrl}">${storeName}</a>...</p>
</body>
</html>`);
  } catch (err: any) {
    console.error('[SHARE_OG_PREVIEW] Erro na rota /s/:slug:', err);
    return res.redirect('https://drogaria-esplendido.farmaflow.online');
  }
};

app.get('/s/:slug', handleSharePreviewRoute);
app.get('/api/s/:slug', handleSharePreviewRoute);
app.get('/api/og-preview/:slug', handleSharePreviewRoute);
app.get('/api/share/:slug', handleSharePreviewRoute);

const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/v1/parse-excel", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: "buffer", codepage: 65001 });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: "" }) as any[][];

    const normalize = (str: any) =>
      String(str ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const headerKeywords = [
      "nomedoproduto", "nomeproduto", "nome", "name", "produto", "descricao",
      "ean", "barcode", "codigobarras", "codigodebarras", "codigointerno", "codigo",
      "precodevenda", "precovenda", "preco", "price", "valor",
      "estoque", "stock", "quantidade", "qtd", "fabricante", "categoria"
    ];

    let bestHeaderIdx = 0;
    let maxScore = -1;
    for (let i = 0; i < Math.min(20, aoa.length); i++) {
      const row = aoa[i];
      if (!row || !Array.isArray(row)) continue;
      let score = 0;
      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const cellStr = String(cell).trim();
        if (!cellStr || cellStr.length > 45 || /^\d+([.,]\d+)?$/.test(cellStr)) continue;
        const norm = normalize(cellStr);
        if (!norm) continue;
        if (headerKeywords.includes(norm)) score += 5;
        else if (headerKeywords.some(kw => norm.includes(kw))) score += 2;
      }
      if (score > maxScore) {
        maxScore = score;
        bestHeaderIdx = i;
      }
      if (i === 0 && score >= 6) {
        bestHeaderIdx = 0;
        break;
      }
    }

    const headers = aoa[bestHeaderIdx] || [];
    const data: any[] = [];
    for (let i = bestHeaderIdx + 1; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row || row.length === 0) continue;
      const isEmpty = row.every((c: any) => c === null || c === undefined || String(c).trim() === "");
      if (isEmpty) continue;
      const obj: any = {};
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header !== undefined && header !== null && String(header).trim() !== "") {
          obj[String(header).trim()] = row[j];
        }
      }
      data.push(obj);
    }

    res.json({ data });
  } catch (error: any) {
    console.error("Erro ao processar planilha no servidor:", error);
    res.status(500).json({ error: error.message || "Erro desconhecido ao processar planilha." });
  }
});

app.get("/api/v1/queue/stats", async (req, res) => {
  res.json(webhookQueue.getStats());
});

// Admin endpoints for bypassing RLS
app.get("/api/v1/tenants/:id/orders", async (req, res) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(200); // OTMIZACAO: Limita a 200 ultimos pedidos no dashboard inicial
    
    if (error) throw error;

    // Fetch medical prescriptions for these orders
    const orderIds = (data || []).map(o => o.id);
    let prescriptionsMap = {};
    
    if (orderIds.length > 0) {
      const { data: prescriptions, error: rxError } = await supabaseAdmin
        .from("medical_prescriptions")
        .select("order_id, status")
        .eq("store_id", id)
        .in("order_id", orderIds);
        
      if (!rxError && prescriptions) {
        prescriptionsMap = prescriptions.reduce((acc, rx) => {
          if (rx.order_id) acc[rx.order_id] = rx.status;
          return acc;
        }, {});
      }
    }

    const enhancedData = (data || []).map(order => ({
      ...order,
      prescription_status: prescriptionsMap[order.id] || null
    }));

    res.json(enhancedData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/v1/tenants/:id/orders", async (req, res) => {
  try {
    const dbOrders = req.body;
    const { error } = await supabaseAdmin
      .from("orders")
      .upsert(dbOrders);

    if (error) {
      const code = String((error as any)?.code || "");
      const msg = `${(error as any)?.message || ""} ${(error as any)?.details || ""} ${(error as any)?.hint || ""}`.toLowerCase();
      const isMissingOriginCol =
        code === "42703" ||
        code === "PGRST204" ||
        (msg.includes("origin") &&
          (msg.includes("column") || msg.includes("schema cache") || msg.includes("does not exist")));

      if (isMissingOriginCol) {
        const stripOrigin = (row: any) => {
          if (!row || typeof row !== "object") return row;
          const { origin: _removed, ...rest } = row;
          return rest;
        };
        const sanitizedPayload = Array.isArray(dbOrders)
          ? dbOrders.map(stripOrigin)
          : stripOrigin(dbOrders);
        const { error: retryError } = await supabaseAdmin
          .from("orders")
          .upsert(sanitizedPayload);
        if (retryError) throw retryError;
        return res.json({ success: true });
      }
      throw error;
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/orders/admin/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { error } = await supabaseAdmin
      .from("orders")
      .delete()
      .eq("id", orderId);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/tenants/admin", async (req, res) => {
  try {
    const { data, error } = await supabase.from("tenants").select("*");
    if (error) throw error;
    const sanitized = Array.isArray(data)
      ? data.map((row) => sanitizeTenantErpCredentialsForClient(row))
      : data;
    res.json({ data: sanitized });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/version", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ version: "3.0.5" });
});

// ============================================================================
// CACHE EM MEMÓRIA RAM (TTL 10 MINUTOS) PARA TENANTS, MANIFEST E INDEX.HTML
// ============================================================================
const TENANT_RAM_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const tenantRamCacheByIdentifier = new Map<string, { tenant: any; expiresAt: number }>();
let allTenantsRamCache: { list: any[]; expiresAt: number } | null = null;
let cachedIndexHtmlRam: { content: string; filePath: string; loadedAt: number } | null = null;

function getIndexHtmlFromRam(): string | null {
  const now = Date.now();
  if (cachedIndexHtmlRam && now - cachedIndexHtmlRam.loadedAt < TENANT_RAM_CACHE_TTL_MS) {
    return cachedIndexHtmlRam.content;
  }
  const distHtml = path.join(process.cwd(), "dist", "index.html");
  const rootHtml = path.join(process.cwd(), "index.html");
  const filePath = fs.existsSync(distHtml) ? distHtml : rootHtml;
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      cachedIndexHtmlRam = { content, filePath, loadedAt: now };
      return content;
    } catch (_) {}
  }
  return null;
}

function normalizeTenantCacheKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.\-_]/g, "");
}

function storeTenantInRamCache(tenant: any, extraKeys: string[] = []): void {
  if (!tenant) return;
  const expiresAt = Date.now() + TENANT_RAM_CACHE_TTL_MS;
  const keys = new Set<string>(extraKeys.map(normalizeTenantCacheKey).filter(Boolean));
  if (tenant.id) keys.add(normalizeTenantCacheKey(tenant.id));
  if (tenant.slug) {
    keys.add(normalizeTenantCacheKey(tenant.slug));
    keys.add(String(tenant.slug).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""));
  }
  if (tenant.custom_domain) keys.add(normalizeTenantCacheKey(tenant.custom_domain));
  for (const k of keys) {
    tenantRamCacheByIdentifier.set(k, { tenant, expiresAt });
  }
}

function getTenantFromRamCacheSync(identifier: string): any | null {
  if (!identifier) return null;
  const now = Date.now();
  const key = normalizeTenantCacheKey(identifier);
  const direct = tenantRamCacheByIdentifier.get(key);
  if (direct && direct.expiresAt > now) {
    return direct.tenant;
  }
  const alphaKey = key.replace(/[^a-z0-9]/g, "");
  const alphaDirect = tenantRamCacheByIdentifier.get(alphaKey);
  if (alphaDirect && alphaDirect.expiresAt > now) {
    return alphaDirect.tenant;
  }
  return null;
}

async function getTenantCachedOrFetch(identifier: string): Promise<any | null> {
  if (!identifier) return null;
  const cached = getTenantFromRamCacheSync(identifier);
  if (cached !== null) return cached;

  const cleanReq = identifier
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  let tenant: any = null;

  // 1. Busca direta por ID, Slug ou Custom Domain
  try {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .or(`id.eq.${identifier},slug.eq.${identifier},custom_domain.eq.${identifier}`)
      .maybeSingle();

    if (!error && data) {
      tenant = data;
    }
  } catch (_) {
    try {
      const { data, error } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .or(`id.eq.${identifier},slug.eq.${identifier}`)
        .maybeSingle();
      if (!error && data) {
        tenant = data;
      }
    } catch (_) {}
  }

  // 2. Fallback: lista em cache de 10 minutos
  if (!tenant) {
    try {
      const now = Date.now();
      let allTenants =
        allTenantsRamCache && allTenantsRamCache.expiresAt > now
          ? allTenantsRamCache.list
          : null;

      if (!allTenants) {
        const { data } = await supabaseAdmin.from("tenants").select("*");
        if (Array.isArray(data)) {
          allTenants = data;
          allTenantsRamCache = {
            list: data,
            expiresAt: now + TENANT_RAM_CACHE_TTL_MS,
          };
          for (const t of data) {
            storeTenantInRamCache(t);
          }
        }
      }

      if (allTenants) {
        tenant =
          allTenants.find((t: any) => {
            const rawSlug = (t.slug || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]/g, "");
            const rawId = (t.id || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]/g, "");
            const rawName = (t.name || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]/g, "");
            const rawCustom = (t.custom_domain || "").toLowerCase();
            return (
              rawSlug === cleanReq ||
              rawId === cleanReq ||
              rawName === cleanReq ||
              rawCustom === identifier.toLowerCase()
            );
          }) || null;
      }
    } catch (_) {}
  }

  if (tenant) {
    storeTenantInRamCache(tenant, [identifier, cleanReq]);
  }
  return tenant;
}

app.get("/api/v1/resolve-tenant", async (req, res) => {
  try {
    const host = req.query.hostname || req.headers.host || "";
    const hostname = String(host).split(":")[0]; // Remove port if present

    let tenantData = getTenantFromRamCacheSync(hostname);

    // Regra A (Subdomínio)
    if (!tenantData && (hostname.endsWith(".farmaflow.online") || hostname.endsWith(".nexoia.online"))) {
      const parts = hostname.split(".");
      const tenantSlug = parts[0];
      
      if (tenantSlug && tenantSlug !== "www" && tenantSlug !== "farmaflow" && tenantSlug !== "nexoia") {
        tenantData = await getTenantCachedOrFetch(tenantSlug);
      }
    } 
    
    // Regra B (Domínio Próprio)
    if (!tenantData && hostname) {
      tenantData = await getTenantCachedOrFetch(hostname);
    }

    if (tenantData) {
      storeTenantInRamCache(tenantData, [hostname]);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json({ tenant: sanitizeTenantErpCredentialsForClient(tenantData) });
    } else {
      return res.status(404).json({ error: "Tenant not found for this domain" });
    }
  } catch (e: any) {
    if (e.code === "42703") {
      return res.status(404).json({ error: "Tenant not found for this domain" });
    }
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// OPEN GRAPH / SEO LOCAL PROGRAMÁTICO MULTITENANT (ZERO BREAKING CHANGES)
// ============================================================================

const isSocialCrawler = (userAgent: string = ""): boolean => {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|meta-externalagent|meta-externalfetcher|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview|googlebot|google-inspectiontool|googleother|storebot-google|adsbot-google|apis-google|mediapartners-google|chrome-lighthouse|bingbot|baiduspider|yandex|applebot|duckduckbot|petalbot|crawlers|axios|node-fetch|got|undici|curl|evolution|baileys/i.test(userAgent);
};

// Crawlers puramente sociais que não executam JS (WhatsApp, Facebook, Telegram, etc.)
const isSocialPreviewBot = (userAgent: string = ""): boolean => {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|meta-externalagent|meta-externalfetcher|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview|evolution|baileys/i.test(userAgent);
};

const SEO_LOOKUP_TIMEOUT_MS = 3500;
const SEO_PRODUCT_CACHE_TTL_MS = 60 * 1000; // 1 minuto
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const GOOGLE_SHOPPING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const GOOGLE_SHOPPING_TIMEOUT_MS = 4000;

const seoProductRamCache = new Map<string, { product: any | null; expiresAt: number }>();
const sitemapIndexRamCache = new Map<string, { xml: string; expiresAt: number }>();
const storeSitemapRamCache = new Map<string, { xml: string; expiresAt: number }>();
const googleShoppingRamCache = new Map<string, { xml: string; expiresAt: number }>();

async function withSeoTimeout<T>(promise: Promise<T>, ms = SEO_LOOKUP_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function escapeHtmlAttr(str: string = ""): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(str: string = ""): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeJsonLdStringify(obj: Record<string, any>): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function slugifySeoTextServer(text: string = "", maxLength = 65): string {
  const cleaned = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned || cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength);
  const lastDash = sliced.lastIndexOf("-");
  return (lastDash > 15 ? sliced.slice(0, lastDash) : sliced).replace(/-+$/g, "");
}

function getSeoTenantSlug(tenant: any): string {
  const raw = String(tenant?.slug || tenant?.subdomain || tenant?.id || tenant?.name || "").trim();
  return slugifySeoTextServer(raw, 80) || String(tenant?.id || "");
}

function getSeoProductShortCode(product: any): string {
  const rawInternal = String(product?.internal_code || product?.internalCode || "").trim();
  if (rawInternal && /^[a-zA-Z0-9]{1,20}$/.test(rawInternal)) {
    return rawInternal.toLowerCase();
  }
  const rawBarcode = String(product?.barcode || "").trim();
  if (rawBarcode && /^[a-zA-Z0-9]{4,20}$/.test(rawBarcode)) {
    return rawBarcode.toLowerCase();
  }
  const rawId = String(product?.id || "").trim();
  if (!rawId) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    return rawId.slice(0, 8).toLowerCase();
  }
  const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleanId.length <= 16 ? cleanId : cleanId.slice(-10);
}

function buildSeoProductSlug(product: any): string {
  const nameSlug = slugifySeoTextServer(product?.name || "", 65);
  const shortCode = getSeoProductShortCode(product);
  if (nameSlug && shortCode) {
    if (nameSlug.endsWith(`-${shortCode}`) || nameSlug === shortCode) {
      return nameSlug;
    }
    return `${nameSlug}-${shortCode}`;
  }
  if (nameSlug) return nameSlug;
  if (shortCode) return shortCode;
  return slugifySeoTextServer(String(product?.id || "produto"), 40) || "produto";
}

function extractSeoProductToken(rawSlugOrId: string): { raw: string; token: string; nameWords: string[] } {
  let raw = String(rawSlugOrId || "").trim();
  try {
    raw = decodeURIComponent(raw).trim();
  } catch {}
  if (!raw) return { raw: "", token: "", nameWords: [] };

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { raw, token: raw, nameWords: [] };
  }

  const lastDash = raw.lastIndexOf("-");
  if (lastDash > 0 && lastDash < raw.length - 1) {
    const token = raw.slice(lastDash + 1).trim();
    const prefix = raw.slice(0, lastDash).trim();
    const nameWords = prefix
      .split("-")
      .map((w) => w.trim())
      .filter((w) => w.length >= 3);
    return { raw, token, nameWords };
  }
  return { raw, token: raw, nameWords: [] };
}

function acceptsHtmlForSeo(req: express.Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const p = String(req.path || "").toLowerCase();
  if (
    p.startsWith("/api/") ||
    p.startsWith("/admin") ||
    p.startsWith("/painel") ||
    p.startsWith("/login") ||
    p.startsWith("/s/") ||
    p.startsWith("/assets/") ||
    p.startsWith("/installers/") ||
    p === "/sw.js" ||
    p === "/manifest.json" ||
    p === "/robots.txt" ||
    p === "/sitemap.xml" ||
    p.endsWith("/sitemap.xml") ||
    p === "/google-shopping.xml" ||
    p.endsWith("/google-shopping.xml") ||
    /\.(js|mjs|cjs|css|map|png|jpe?g|gif|webp|svg|ico|json|xml|txt|woff2?|ttf|eot|pdf|zip|exe|mp3|mp4|webm)$/i.test(p)
  ) {
    return false;
  }
  const accept = String(req.headers.accept || "").toLowerCase().trim();
  const ua = String(req.headers["user-agent"] || "");
  if (accept.includes("text/html")) return true;
  if (!accept || accept === "*/*" || accept.includes("*/*")) {
    // Permite Google-InspectionTool (Teste de Pesquisa Aprimorada), bots e proxies que enviam Accept: */*
    if (
      !accept.includes("application/json") &&
      !accept.includes("image/") &&
      !accept.includes("text/css") &&
      !accept.includes("javascript")
    ) {
      return true;
    }
  }
  if (isSocialCrawler(ua)) return true;
  return false;
}

function resolveRequestOrigin(req: express.Request): { proto: string; host: string; baseUrl: string } {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "farmaflow.online")
    .split(",")[0]
    .trim()
    .split(":")[0];
  const rawProto = String(req.headers["x-forwarded-proto"] || (req.secure ? "https" : "https"))
    .split(",")[0]
    .trim();
  const proto = rawProto === "http" && (host === "localhost" || host === "127.0.0.1") ? "http" : "https";
  return { proto, host, baseUrl: `${proto}://${host}` };
}

function extractProductIdentifierFromRequest(req: express.Request): string {
  const paramSlug = Array.isArray(req.params?.productSlug)
    ? req.params.productSlug[0]
    : req.params?.productSlug
      ? String(req.params.productSlug)
      : "";
  const paramId = Array.isArray(req.params?.id)
    ? req.params.id[0]
    : req.params?.id
      ? String(req.params.id)
      : "";
  const queryProd = String(
    req.query?.produto || req.query?.product || req.query?.prod || req.query?.oferta || ""
  ).trim();

  if (paramSlug) return paramSlug.trim();
  if (paramId) return paramId.trim();
  if (queryProd) return queryProd;

  const pathMatch = String(req.path || "").match(/\/produto\/([^/?#]+)/i);
  if (pathMatch && pathMatch[1]) {
    try {
      return decodeURIComponent(pathMatch[1]).trim();
    } catch {
      return pathMatch[1].trim();
    }
  }
  return "";
}

async function fetchProductForSeo(tenantId: string, rawProductSlugOrId: string): Promise<any | null> {
  if (!tenantId || !rawProductSlugOrId) return null;
  const { raw, token, nameWords } = extractSeoProductToken(rawProductSlugOrId);
  if (!raw) return null;

  const cacheKey = `${tenantId}|${raw.toLowerCase()}`;
  const now = Date.now();
  const cached = seoProductRamCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.product;
  }

  const selectCols =
    "id, tenant_id, internal_code, barcode, name, manufacturer, presentation, description, category, price, original_price, promotional_price, stock, image";

  const remember = (prod: any | null) => {
    if (seoProductRamCache.size > 1000) {
      seoProductRamCache.clear();
    }
    seoProductRamCache.set(cacheKey, { product: prod, expiresAt: Date.now() + SEO_PRODUCT_CACHE_TTL_MS });
    return prod;
  };

  try {
    // 1. Tentativa exata por ID (ex.: ?produto=UUID ou /produto/ID)
    if (raw === token || /^[0-9a-f-]{8,64}$/i.test(raw)) {
      try {
        const { data: byId } = await supabaseAdmin
          .from("products")
          .select(selectCols)
          .eq("tenant_id", tenantId)
          .eq("id", raw)
          .maybeSingle();
        if (byId) return remember(byId);
      } catch (_) {}
    }

    // 2. Tentativa por internal_code (exato ou case-insensitive, já que o slug usa minúsculas)
    if (token && /^[a-zA-Z0-9_-]{1,32}$/.test(token)) {
      try {
        const { data: byCodeList } = await supabaseAdmin
          .from("products")
          .select(selectCols)
          .eq("tenant_id", tenantId)
          .ilike("internal_code", token)
          .limit(5);
        if (Array.isArray(byCodeList) && byCodeList.length > 0) {
          const exactSlug = byCodeList.find((r) => buildSeoProductSlug(r).toLowerCase() === raw.toLowerCase());
          return remember(exactSlug || byCodeList[0]);
        }
      } catch (_) {}

      // 3. Tentativa por barcode (EAN)
      if (/^\d{4,20}$/.test(token)) {
        try {
          const { data: byBarcodeList } = await supabaseAdmin
            .from("products")
            .select(selectCols)
            .eq("tenant_id", tenantId)
            .eq("barcode", token)
            .limit(5);
          if (Array.isArray(byBarcodeList) && byBarcodeList.length > 0) {
            const exactSlug = byBarcodeList.find((r) => buildSeoProductSlug(r).toLowerCase() === raw.toLowerCase());
            return remember(exactSlug || byBarcodeList[0]);
          }
        } catch (_) {}
      }

      // 4. Tentativa por id igual ao token curto
      if (token !== raw) {
        try {
          const { data: byShortId } = await supabaseAdmin
            .from("products")
            .select(selectCols)
            .eq("tenant_id", tenantId)
            .eq("id", token)
            .maybeSingle();
          if (byShortId) return remember(byShortId);
        } catch (_) {}
      }
    }

    // 5. Fallback para slugs com prefixo curto de UUID (ex.: dipirona-500mg-a1b2c3d4)
    if (nameWords.length > 0) {
      const searchWord = nameWords[0].replace(/[%_]/g, "");
      if (searchWord.length >= 3) {
        try {
          const { data: candidates } = await supabaseAdmin
            .from("products")
            .select(selectCols)
            .eq("tenant_id", tenantId)
            .ilike("name", `%${searchWord}%`)
            .limit(25);
          if (Array.isArray(candidates) && candidates.length > 0) {
            const lowerRaw = raw.toLowerCase();
            const lowerToken = token.toLowerCase();
            const matched =
              candidates.find((r) => buildSeoProductSlug(r).toLowerCase() === lowerRaw) ||
              candidates.find((r) => {
                const rid = String(r.id || "").toLowerCase();
                const ridClean = rid.replace(/[^a-z0-9]/g, "");
                return (
                  (lowerToken.length >= 6 && (rid.startsWith(lowerToken) || ridClean.endsWith(lowerToken))) ||
                  String(r.internal_code || "").toLowerCase() === lowerToken ||
                  String(r.barcode || "").toLowerCase() === lowerToken
                );
              });
            if (matched) return remember(matched);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  return remember(null);
}

interface TenantMetaRecord {
  id: string;
  name: string;
  slug: string;
  title: string;
  description: string;
  logoUrl: string;
  storeLogoUrl: string;
  canonicalUrl: string;
  storeUrl: string;
  location: string;
  phone: string;
  ogType: "website" | "product";
  priceAmount?: string;
  availability?: "InStock" | "OutOfStock";
  jsonLd?: Record<string, any>;
  rawTenant?: any;
  rawProduct?: any;
}

function buildPharmacyPostalAddress(tenant: any): Record<string, any> | undefined {
  const streetParts = [
    tenant?.street || tenant?.logradouro,
    tenant?.address_number || tenant?.addressnumber || tenant?.numero,
  ].filter(Boolean);
  const neighborhood = String(tenant?.neighborhood || tenant?.bairro || "").trim();
  let streetAddress = streetParts.join(", ");
  if (neighborhood) {
    streetAddress = streetAddress ? `${streetAddress} - ${neighborhood}` : neighborhood;
  }
  if (!streetAddress && (tenant?.full_address || tenant?.fulladdress)) {
    streetAddress = String(tenant.full_address || tenant.fulladdress).trim();
  }

  const city = String(tenant?.city || tenant?.cidade || "").trim();
  const state = String(tenant?.state || tenant?.uf || "").trim();
  const cep = String(tenant?.cep || "").trim();

  if (!streetAddress && !city && !state && !cep) return undefined;

  const address: Record<string, any> = {
    "@type": "PostalAddress",
    addressCountry: "BR",
  };
  if (streetAddress) address.streetAddress = streetAddress;
  if (city) address.addressLocality = city;
  if (state) address.addressRegion = state;
  if (cep) address.postalCode = cep;
  return address;
}

function buildPharmacyJsonLd(tenant: any, storeName: string, storeUrl: string, storeLogoUrl: string): Record<string, any> {
  const phone = String(tenant?.telefone_contato || tenant?.phone || tenant?.whatsapp || "").trim();
  const address = buildPharmacyPostalAddress(tenant);
  const jsonLd: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Pharmacy",
    name: storeName,
    url: storeUrl,
    image: storeLogoUrl,
    logo: storeLogoUrl,
  };
  if (phone) jsonLd.telephone = phone;
  if (address) jsonLd.address = address;
  return jsonLd;
}

function parseSafePositivePrice(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  const cleaned = typeof val === "string" ? val.replace(/[^\d.,-]/g, "").replace(",", ".") : val;
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function resolveEffectiveProductPrice(product: any): number {
  const price = parseSafePositivePrice(product?.price);
  const promo = parseSafePositivePrice(product?.promotional_price);
  const orig = parseSafePositivePrice(product?.original_price);
  if (promo > 0 && (price <= 0 || promo < price)) return promo;
  if (price > 0) return price;
  if (orig > 0) return orig;
  return 0;
}

function ensureAbsoluteHttpsUrl(urlStr: string | undefined | null, fallbackUrl: string): string {
  const raw = String(urlStr || "").trim();
  if (
    raw &&
    raw !== "IGNORE" &&
    raw !== "PENDENTE_CURADORIA" &&
    !raw.startsWith("data:") &&
    (raw.startsWith("https://") || raw.startsWith("http://"))
  ) {
    return raw.startsWith("http://") ? raw.replace("http://", "https://") : raw;
  }
  const fb = String(fallbackUrl || DEFAULT_FALLBACK_OG_LOGO).trim();
  if (fb.startsWith("https://")) return fb;
  if (fb.startsWith("http://")) return fb.replace("http://", "https://");
  return DEFAULT_FALLBACK_OG_LOGO;
}

function buildTenantMetaRecordFromTenant(
  tenant: any,
  req: express.Request,
  product?: any | null
): TenantMetaRecord {
  const { proto, host, baseUrl } = resolveRequestOrigin(req);

  const storeName = String(tenant.name || tenant.razao_social || "FarmaFlow Drogaria").trim();
  const neighborhood = String(tenant.neighborhood || tenant.bairro || "").trim();
  const city = String(tenant.city || tenant.cidade || "").trim();
  const state = String(tenant.state || tenant.uf || "").trim();
  const locParts = [neighborhood, city, state].filter(Boolean);
  const location = locParts.length > 0 ? locParts.join(" - ") : "";
  const cityState = [city, state].filter(Boolean).join("/");

  const tenantSlug = getSeoTenantSlug(tenant);

  const rawLogo = String(
    tenant.logo_url || tenant.logo || tenant.smart_banners?._regulatoryData?.logo_url || ""
  ).trim();
  let storeLogoUrl = DEFAULT_FALLBACK_OG_LOGO;
  if ((rawLogo.startsWith("http://") || rawLogo.startsWith("https://")) && !rawLogo.startsWith("data:")) {
    storeLogoUrl = rawLogo.startsWith("http://") ? rawLogo.replace("http://", "https://") : rawLogo;
  } else if (tenant.id && (rawLogo.length > 0 || tenant.logo)) {
    storeLogoUrl = `${baseUrl}/api/v1/store/${encodeURIComponent(tenant.id)}/logo.png`;
    if (storeLogoUrl.startsWith("http://") && !host.startsWith("localhost")) {
      storeLogoUrl = storeLogoUrl.replace("http://", "https://");
    }
  }
  storeLogoUrl = ensureAbsoluteHttpsUrl(storeLogoUrl, DEFAULT_FALLBACK_OG_LOGO);

  const lowerHost = host.toLowerCase();
  const reservedSubdomains = ["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"];
  const isSubdomainHost =
    (lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
    !reservedSubdomains.includes(lowerHost.split(".")[0]);
  const cleanCustomDomain =
    tenant.custom_domain && String(tenant.custom_domain).trim()
      ? String(tenant.custom_domain).replace(/^https?:\/\//, "").replace(/\/+$/, "").trim()
      : "";
  const isCustomDomainHost = Boolean(cleanCustomDomain && lowerHost === cleanCustomDomain.toLowerCase());

  let storeUrl = `${baseUrl}/loja/${encodeURIComponent(tenantSlug)}`;
  if (isCustomDomainHost) {
    storeUrl = `${proto}://${host}`;
  } else if (isSubdomainHost) {
    storeUrl = `${proto}://${host}`;
  } else if (cleanCustomDomain) {
    storeUrl = `https://${cleanCustomDomain}`;
  }

  // Metadados padrão da loja (Pharmacy)
  let title = `${storeName}${location ? ` (${location})` : ""} - Farmácia Online & Delivery`;
  let description =
    String(
      tenant.description ||
        tenant.banner_subtitle ||
        tenant.bannersubtitle ||
        tenant.banner_title ||
        tenant.bannertitle ||
        ""
    ).trim() ||
    `Compre medicamentos, perfumaria e saúde na ${storeName}${location ? ` em ${location}` : ""}. Entrega rápida e pedido online direto no WhatsApp.`;
  let logoUrl = storeLogoUrl;
  let canonicalUrl = storeUrl;
  let ogType: "website" | "product" = "website";
  let priceAmount: string | undefined;
  let availability: "InStock" | "OutOfStock" | undefined;
  let jsonLd: Record<string, any> = buildPharmacyJsonLd(tenant, storeName, storeUrl, storeLogoUrl);

  // Enriquecimento SEO para Produto (Product + Offer validado para Google Rich Results)
  if (product && product.name) {
    const productName = String(product.name).trim();
    const effectivePrice = resolveEffectiveProductPrice(product);
    const formattedPriceDecimal = effectivePrice > 0 ? effectivePrice.toFixed(2) : "0.00";
    const formattedBrPrice =
      effectivePrice > 0 ? `R$ ${formattedPriceDecimal.replace(".", ",")}` : "";
    const inStock = Number(product.stock ?? 0) > 0;
    const productSlug = buildSeoProductSlug(product);
    logoUrl = ensureAbsoluteHttpsUrl(product.image || product.image_url, storeLogoUrl);

    if (isSubdomainHost || isCustomDomainHost) {
      canonicalUrl = `${proto}://${host}/produto/${encodeURIComponent(productSlug)}`;
    } else if (cleanCustomDomain) {
      canonicalUrl = `https://${cleanCustomDomain}/produto/${encodeURIComponent(productSlug)}`;
    } else {
      canonicalUrl = `${baseUrl}/loja/${encodeURIComponent(tenantSlug)}/produto/${encodeURIComponent(productSlug)}`;
    }

    title = `${productName}${formattedBrPrice ? ` por ${formattedBrPrice}` : ""} | ${storeName}${cityState ? ` - ${cityState}` : ""}`;
    description = `Compre ${productName}${product.presentation ? ` (${product.presentation})` : ""}${formattedBrPrice ? ` por ${formattedBrPrice}` : ""} na ${storeName}${location ? ` em ${location}` : ""}. ${inStock ? "Produto em estoque com entrega rápida" : "Consulte disponibilidade"} via WhatsApp.`;
    ogType = "product";
    if (effectivePrice > 0) {
      priceAmount = formattedPriceDecimal;
    }
    availability = inStock ? "InStock" : "OutOfStock";

    const sellerSchema = buildPharmacyJsonLd(tenant, storeName, storeUrl, storeLogoUrl);
    delete sellerSchema["@context"];

    const offerSchema: Record<string, any> = {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: "BRL",
      price: formattedPriceDecimal,
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: sellerSchema,
    };

    const productSchema: Record<string, any> = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: productName,
      description: String(product.description || description).trim().slice(0, 500),
      image: [logoUrl],
      sku: String(product.internal_code || product.id || productSlug),
      offers: offerSchema,
    };
    const cleanBarcode = String(product.barcode || "").replace(/\D/g, "");
    if (cleanBarcode.length === 13) {
      productSchema.gtin13 = cleanBarcode;
    } else if (cleanBarcode.length >= 8 && cleanBarcode.length <= 14) {
      productSchema.gtin = cleanBarcode;
    }
    if (product.manufacturer && String(product.manufacturer).trim() && String(product.manufacturer).trim() !== "Outros") {
      productSchema.brand = {
        "@type": "Brand",
        name: String(product.manufacturer).trim(),
      };
    }

    jsonLd = productSchema;
  }

  return {
    id: tenant.id,
    name: storeName,
    slug: tenantSlug,
    title,
    description,
    logoUrl,
    storeLogoUrl,
    canonicalUrl,
    storeUrl,
    location,
    phone: String(tenant.telefone_contato || tenant.phone || tenant.whatsapp || ""),
    ogType,
    priceAmount,
    availability,
    jsonLd,
    rawTenant: tenant,
    rawProduct: product || undefined,
  };
}

async function getTenantMetaRecord(identifier: string, req: express.Request): Promise<TenantMetaRecord | null> {
  if (!identifier) return null;
  const tenant = await withSeoTimeout(getTenantCachedOrFetch(identifier), SEO_LOOKUP_TIMEOUT_MS);
  if (!tenant) return null;

  const targetProdIdentifier = extractProductIdentifierFromRequest(req);
  let productData: any | null = null;
  if (targetProdIdentifier) {
    productData = await withSeoTimeout(
      fetchProductForSeo(String(tenant.id), targetProdIdentifier),
      SEO_LOOKUP_TIMEOUT_MS
    );
  }

  return buildTenantMetaRecordFromTenant(tenant, req, productData);
}

function generateStoreOpenGraphHtml(meta: TenantMetaRecord): string {
  const titleText = escapeHtmlAttr(meta.title || meta.name || "FarmaFlow");
  const siteName = escapeHtmlAttr(meta.name || "FarmaFlow");
  const rawLogo = meta.logoUrl || DEFAULT_FALLBACK_OG_LOGO;
  const logoUrl = escapeHtmlAttr(rawLogo);
  const imageType = detectOgImageType(rawLogo);
  const descricao = escapeHtmlAttr(
    meta.description || `Faça seu pedido online com rapidez e comodidade na ${meta.name || "nossa drogaria"}.`
  );
  const currentUrl = escapeHtmlAttr(meta.canonicalUrl || meta.storeUrl || "https://farmaflow.online");
  const ogType = meta.ogType === "product" ? "product" : "website";
  const priceMeta =
    meta.ogType === "product" && meta.priceAmount
      ? `\n  <meta property="product:price:amount" content="${escapeHtmlAttr(meta.priceAmount)}" />\n  <meta property="product:price:currency" content="BRL" />`
      : "";
  const jsonLdScript = meta.jsonLd
    ? `\n  <script type="application/ld+json" data-farmaflow-seo="true">${safeJsonLdStringify(meta.jsonLd)}</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${titleText}</title>
  <meta name="description" content="${descricao}" />
  <link rel="canonical" href="${currentUrl}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${siteName}" />
  <meta property="og:title" content="${titleText}" />
  <meta property="og:description" content="${descricao}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:image:alt" content="${titleText}" />
  <meta property="og:url" content="${currentUrl}" />${priceMeta}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${titleText}" />
  <meta name="twitter:description" content="${descricao}" />
  <meta name="twitter:image" content="${logoUrl}" />
  <link rel="icon" href="${escapeHtmlAttr(meta.storeLogoUrl || rawLogo)}" />
  <link rel="apple-touch-icon" href="${escapeHtmlAttr(meta.storeLogoUrl || rawLogo)}" />${jsonLdScript}
</head>
<body></body>
</html>`;
}

function injectStoreMetaIntoHtml(html: string, meta: TenantMetaRecord): string {
  try {
    let updated = html;
    const escTitle = escapeHtmlAttr(meta.title);
    const escDesc = escapeHtmlAttr(meta.description);
    const escName = escapeHtmlAttr(meta.name);
    const escUrl = escapeHtmlAttr(meta.canonicalUrl);
    const escImg = escapeHtmlAttr(meta.logoUrl);
    const escStoreLogo = escapeHtmlAttr(meta.storeLogoUrl || meta.logoUrl);
    const imageType = detectOgImageType(meta.logoUrl);
    const ogType = meta.ogType === "product" ? "product" : "website";

    updated = updated.replace(/<title>.*?<\/title>/i, () => `<title>${escTitle}</title>`);

    if (updated.includes('property="og:type"')) {
      updated = updated.replace(
        /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:type" content="${ogType}" />`
      );
    }
    if (updated.includes('property="og:title"')) {
      updated = updated.replace(
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:title" content="${escTitle}" />`
      );
    }
    if (updated.includes('property="og:description"')) {
      updated = updated.replace(
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:description" content="${escDesc}" />`
      );
    }
    if (updated.includes('property="og:url"')) {
      updated = updated.replace(
        /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:url" content="${escUrl}" />`
      );
    }
    if (updated.includes('property="og:site_name"')) {
      updated = updated.replace(
        /<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:site_name" content="${escName}" />`
      );
    }
    if (updated.includes('property="og:image"')) {
      updated = updated.replace(
        /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:image" content="${escImg}" />`
      );
    }
    if (updated.includes('property="og:image:secure_url"')) {
      updated = updated.replace(
        /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:image:secure_url" content="${escImg}" />`
      );
    }
    if (updated.includes('property="og:image:type"')) {
      updated = updated.replace(
        /<meta\s+property="og:image:type"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:image:type" content="${imageType}" />`
      );
    }
    if (updated.includes('property="og:image:alt"')) {
      updated = updated.replace(
        /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta property="og:image:alt" content="${escTitle}" />`
      );
    }
    if (updated.includes('name="twitter:card"')) {
      updated = updated.replace(
        /<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta name="twitter:card" content="summary_large_image" />`
      );
    }
    if (updated.includes('name="twitter:title"')) {
      updated = updated.replace(
        /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta name="twitter:title" content="${escTitle}" />`
      );
    }
    if (updated.includes('name="twitter:description"')) {
      updated = updated.replace(
        /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta name="twitter:description" content="${escDesc}" />`
      );
    }
    if (updated.includes('name="twitter:image"')) {
      updated = updated.replace(
        /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta name="twitter:image" content="${escImg}" />`
      );
    }
    if (updated.includes('name="description"')) {
      updated = updated.replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
        () => `<meta name="description" content="${escDesc}" />`
      );
    }
    if (meta.storeLogoUrl && !meta.storeLogoUrl.includes("preview-share.png")) {
      const storeLogoType = detectOgImageType(meta.storeLogoUrl);
      updated = updated.replace(
        /<link\s+rel="icon"[^>]*>/i,
        () => `<link rel="icon" type="${storeLogoType}" href="${escStoreLogo}" />`
      );
      updated = updated.replace(
        /<link\s+rel="apple-touch-icon"[^>]*>/i,
        () => `<link rel="apple-touch-icon" href="${escStoreLogo}" />`
      );
    }

    // Remove canonical ou JSON-LD anterior injetado caso exista
    updated = updated.replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "");
    updated = updated.replace(/<script\s+type="application\/ld\+json"\s+data-farmaflow-seo="true">[\s\S]*?<\/script>\s*/gi, "");

    const extraHeadTags: string[] = [`<link rel="canonical" href="${escUrl}" />`];
    if (meta.ogType === "product" && meta.priceAmount) {
      extraHeadTags.push(`<meta property="product:price:amount" content="${escapeHtmlAttr(meta.priceAmount)}" />`);
      extraHeadTags.push(`<meta property="product:price:currency" content="BRL" />`);
    }
    if (meta.jsonLd) {
      extraHeadTags.push(
        `<script type="application/ld+json" data-farmaflow-seo="true">${safeJsonLdStringify(meta.jsonLd)}</script>`
      );
    }

    updated = updated.replace(/<\/head>/i, () => `    ${extraHeadTags.join("\n    ")}\n  </head>`);
    return updated;
  } catch {
    // Fallback silencioso: nunca quebra o HTML original
    return html;
  }
}

// Endpoint de Servir Logo da Loja em Formato Binário Real (JPEG/PNG) para WhatsApp e Crawlers
app.get(["/api/v1/store/:tenantId/logo.png", "/api/store-logo/:tenantId.png"], async (req, res) => {
  try {
    const tenantId = Array.isArray(req.params.tenantId) ? req.params.tenantId[0] : String(req.params.tenantId || "");
    const meta = await getTenantMetaRecord(tenantId, req);
    const tenant = meta?.rawTenant;
    const rawLogoStr = String(tenant?.logo_url || tenant?.logo || tenant?.smart_banners?._regulatoryData?.logo_url || "").trim();

    if (rawLogoStr) {
      if (rawLogoStr.startsWith("data:")) {
        const match = rawLogoStr.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const buf = Buffer.from(match[2], "base64");
          res.setHeader("Content-Type", mime);
          res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          return res.send(buf);
        }
      } else if (rawLogoStr.startsWith("http://") || rawLogoStr.startsWith("https://")) {
        try {
          const fetchRes = await fetch(rawLogoStr);
          if (fetchRes.ok) {
            const buf = Buffer.from(await fetchRes.arrayBuffer());
            const mime = fetchRes.headers.get("content-type") || detectOgImageType(rawLogoStr);
            res.setHeader("Content-Type", mime);
            res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
            return res.send(buf);
          }
        } catch (_) {}
        return res.redirect(302, rawLogoStr);
      }
    }

    // Fallback para o logotipo padrão preview-share.png
    const previewPaths = [
      path.join(process.cwd(), "public", "preview-share.png"),
      path.join(process.cwd(), "dist", "preview-share.png"),
    ];
    for (const p of previewPaths) {
      if (fs.existsSync(p)) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p);
      }
    }

    res.status(404).send("Logo não encontrada");
  } catch (err: any) {
    console.error("[StoreLogo] Erro ao servir logo da loja:", err);
    res.status(500).send("Erro interno ao servir logo");
  }
});

// Endpoint /api/og e /api/og-handler de Metadados / Rich Preview Card para Integrações e Crawlers
app.all(["/api/og-handler", "/api/og"], ogHandler);

// ============================================================================
// ROBOTS.TXT E SITEMAPS XML DINÂMICOS (CACHE 1 HORA + FALLBACK SEGURO)
// ============================================================================

app.get("/robots.txt", (req, res) => {
  try {
    const { baseUrl } = resolveRequestOrigin(req);
    const body = [
      "User-agent: *",
      "Allow: /loja/",
      "Allow: /produto/",
      "Allow: /google-shopping.xml",
      "Disallow: /admin",
      "Disallow: /painel",
      "Disallow: /api/",
      "",
      `Sitemap: ${baseUrl}/sitemap.xml`,
      "",
    ].join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(body);
  } catch {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send("User-agent: *\nAllow: /loja/\nAllow: /produto/\nAllow: /google-shopping.xml\nDisallow: /admin\nDisallow: /painel\nDisallow: /api/\n");
  }
});

app.get("/sitemap.xml", async (req, res) => {
  const { host, baseUrl } = resolveRequestOrigin(req);
  const cacheKey = baseUrl.toLowerCase();
  const now = Date.now();

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");

  try {
    const cached = sitemapIndexRamCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.status(200).send(cached.xml);
    }

    const today = new Date().toISOString().split("T")[0];
    const isSubdomain =
      (host.endsWith(".farmaflow.online") || host.endsWith(".nexoia.online")) &&
      !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(host.split(".")[0]);

    let activeTenants: any[] = [];
    if (isSubdomain) {
      const subTenant = await withSeoTimeout(getTenantCachedOrFetch(host.split(".")[0]), 2500);
      if (subTenant) activeTenants = [subTenant];
    } else {
      let allTenants =
        allTenantsRamCache && allTenantsRamCache.expiresAt > now ? allTenantsRamCache.list : null;
      if (!allTenants) {
        const fetched = await withSeoTimeout(
          Promise.resolve(
            supabaseAdmin
              .from("tenants")
              .select("id, slug, name, is_blocked, license_expiration")
              .limit(1000)
          ),
          3000
        );
        if (fetched && Array.isArray((fetched as any).data)) {
          allTenants = (fetched as any).data;
        }
      }
      if (Array.isArray(allTenants)) {
        const startOfToday = new Date().setHours(0, 0, 0, 0);
        activeTenants = allTenants.filter((t: any) => {
          if (!t || t.is_blocked === true || t.isblocked === true) return false;
          if (t.license_expiration && new Date(t.license_expiration).getTime() < startOfToday) {
            return false;
          }
          return Boolean(getSeoTenantSlug(t));
        });
      }
    }

    const seenSlugs = new Set<string>();
    const sitemapEntries: string[] = [];
    for (const t of activeTenants) {
      const slug = getSeoTenantSlug(t);
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      const loc = `${baseUrl}/loja/${encodeURIComponent(slug)}/sitemap.xml`;
      sitemapEntries.push(
        `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.join("\n")}\n</sitemapindex>\n`;
    sitemapIndexRamCache.set(cacheKey, { xml, expiresAt: now + SITEMAP_CACHE_TTL_MS });
    return res.status(200).send(xml);
  } catch {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>\n`;
    return res.status(200).send(emptyXml);
  }
});

app.get("/loja/:tenantSlug/sitemap.xml", async (req, res) => {
  const tenantSlugParam = Array.isArray(req.params.tenantSlug)
    ? req.params.tenantSlug[0]
    : String(req.params.tenantSlug || "").trim();
  const { host, baseUrl } = resolveRequestOrigin(req);
  const lowerHost = host.toLowerCase();
  const isStoreHost =
    ((lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
      !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(lowerHost.split(".")[0])) ||
    (lowerHost !== "farmaflow.online" &&
      lowerHost !== "www.farmaflow.online" &&
      lowerHost !== "nexoia.online" &&
      lowerHost !== "farmaflow.nexoia.online" &&
      lowerHost !== "localhost" &&
      lowerHost !== "127.0.0.1" &&
      !lowerHost.includes("run.app"));
  const cacheKey = `${baseUrl.toLowerCase()}|${tenantSlugParam.toLowerCase()}`;
  const now = Date.now();

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200");

  try {
    const cached = storeSitemapRamCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.status(200).send(cached.xml);
    }

    const tenant = await withSeoTimeout(getTenantCachedOrFetch(tenantSlugParam), 2500);
    if (!tenant || tenant.is_blocked === true || tenant.isblocked === true) {
      const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`;
      return res.status(404).send(emptyXml);
    }

    const cleanTenantSlug = getSeoTenantSlug(tenant);
    const today = new Date().toISOString().split("T")[0];
    const storeLoc = isStoreHost
      ? `${baseUrl}/`
      : `${baseUrl}/loja/${encodeURIComponent(cleanTenantSlug)}`;

    const urls: string[] = [
      `  <url>\n    <loc>${escapeXml(storeLoc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ];

    const prodRes = await withSeoTimeout(
      Promise.resolve(
        supabaseAdmin
          .from("products")
          .select("id, name, internal_code, barcode, price, stock")
          .eq("tenant_id", tenant.id)
          .gt("stock", 0)
          .gt("price", 0)
          .limit(5000)
      ),
      3500
    );

    const rows = prodRes && Array.isArray((prodRes as any).data) ? (prodRes as any).data : [];
    const seenProductSlugs = new Set<string>();

    for (const prod of rows) {
      if (!prod?.name || Number(prod.stock ?? 0) <= 0) continue;
      const pSlug = buildSeoProductSlug(prod);
      if (!pSlug || seenProductSlugs.has(pSlug)) continue;
      seenProductSlugs.add(pSlug);
      const prodLoc = isStoreHost
        ? `${baseUrl}/produto/${encodeURIComponent(pSlug)}`
        : `${baseUrl}/loja/${encodeURIComponent(cleanTenantSlug)}/produto/${encodeURIComponent(pSlug)}`;
      urls.push(
        `  <url>\n    <loc>${escapeXml(prodLoc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
    if (storeSitemapRamCache.size > 500) {
      storeSitemapRamCache.clear();
    }
    storeSitemapRamCache.set(cacheKey, { xml, expiresAt: now + SITEMAP_CACHE_TTL_MS });
    return res.status(200).send(xml);
  } catch {
    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`;
    return res.status(200).send(fallbackXml);
  }
});

// ============================================================================
// FEED XML GOOGLE MERCHANT CENTER (RSS 2.0) / META & INSTAGRAM CATALOG
// ============================================================================

function sanitizeXmlText(raw: string = "", maxLength?: number): string {
  let cleaned = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trimEnd();
  }
  return cleaned;
}

function isValidGtinCode(rawBarcode?: string | null): string | null {
  const digits = String(rawBarcode || "").replace(/\D/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  if (/^0+$/.test(digits)) return null;

  // Validação padrão GS1 (dígito verificador Mod-10 exigido pelo Google Merchant Center)
  const body = digits.slice(0, -1);
  const checkDigit = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const num = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? num * 3 : num;
  }
  const expected = (10 - (sum % 10)) % 10;
  return checkDigit === expected ? digits : null;
}

function resolveValidMerchantImageUrl(rawImage?: string | null): string | null {
  const raw = String(rawImage || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower === "ignore" ||
    lower === "pendente_curadoria" ||
    lower.startsWith("data:") ||
    lower.includes("flz8f3x.png") ||
    lower.includes("preview-share.png") ||
    lower.includes("placeholder") ||
    lower.includes("no-image") ||
    lower.includes("sem-foto")
  ) {
    return null;
  }
  if (!raw.startsWith("https://")) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveMerchantPrices(product: any): { normalPrice: number; salePrice: number | null } {
  const price = parseSafePositivePrice(product?.price);
  const promo = parseSafePositivePrice(product?.promotional_price);
  const orig = parseSafePositivePrice(product?.original_price);

  // Caso 1: promotional_price explicitamente menor que price
  if (promo > 0 && price > 0 && promo < price) {
    const normal = orig > price ? orig : price;
    return { normalPrice: normal, salePrice: promo };
  }

  // Caso 2: original_price maior que price (sem promotional_price separado)
  if (orig > 0 && price > 0 && price < orig) {
    return { normalPrice: orig, salePrice: price };
  }

  // Caso 3: preço regular sem promoção
  if (price > 0) {
    return { normalPrice: price, salePrice: null };
  }
  if (orig > 0) {
    return { normalPrice: orig, salePrice: null };
  }
  return { normalPrice: 0, salePrice: null };
}

function isMerchantStoreHost(host: string): boolean {
  const lowerHost = String(host || "").toLowerCase();
  return (
    ((lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
      !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(lowerHost.split(".")[0])) ||
    (lowerHost !== "farmaflow.online" &&
      lowerHost !== "www.farmaflow.online" &&
      lowerHost !== "nexoia.online" &&
      lowerHost !== "farmaflow.nexoia.online" &&
      lowerHost !== "localhost" &&
      lowerHost !== "127.0.0.1" &&
      !lowerHost.includes("run.app"))
  );
}

function buildEmptyMerchantFeedXml(title = "FarmaFlow Feed", link = "https://farmaflow.online"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(sanitizeXmlText(title, 150))}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(sanitizeXmlText(`Catálogo de produtos ${title}`, 250))}</description>`,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

async function handleGoogleShoppingFeedRequest(
  req: express.Request,
  res: express.Response,
  explicitTenantSlug?: string
) {
  const { host, baseUrl } = resolveRequestOrigin(req);
  const lowerHost = host.toLowerCase();
  const isStoreHost = isMerchantStoreHost(lowerHost);

  let tenantIdentifier = String(explicitTenantSlug || "").trim();
  if (!tenantIdentifier) {
    if (lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) {
      const sub = lowerHost.split(".")[0];
      if (sub && !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(sub)) {
        tenantIdentifier = sub;
      }
    } else if (isStoreHost) {
      tenantIdentifier = lowerHost.replace(/^www\./, "");
    }
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (!tenantIdentifier) {
    return res.status(404).send(buildEmptyMerchantFeedXml("FarmaFlow", baseUrl));
  }

  const cacheKey = `${baseUrl.toLowerCase()}|${tenantIdentifier.toLowerCase()}`;
  const now = Date.now();

  try {
    const cached = googleShoppingRamCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.status(200).send(cached.xml);
    }

    const startTime = Date.now();
    const tenant = await withSeoTimeout(
      getTenantCachedOrFetch(tenantIdentifier),
      Math.min(2000, GOOGLE_SHOPPING_TIMEOUT_MS)
    );

    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const isTenantExpired =
      tenant?.license_expiration &&
      new Date(tenant.license_expiration).getTime() < startOfToday;

    if (!tenant || tenant.is_blocked === true || tenant.isblocked === true || isTenantExpired) {
      return res.status(404).send(buildEmptyMerchantFeedXml("Loja não encontrada", baseUrl));
    }

    const cleanTenantSlug = getSeoTenantSlug(tenant);
    const storeName = sanitizeXmlText(tenant.name || tenant.razao_social || "FarmaFlow Drogaria", 120);
    const city = sanitizeXmlText(tenant.city || tenant.cidade || "", 60);
    const state = sanitizeXmlText(tenant.state || tenant.uf || "", 10);
    const cityState = [city, state].filter(Boolean).join("/");

    const channelLink = isStoreHost
      ? `${baseUrl}/`
      : `${baseUrl}/loja/${encodeURIComponent(cleanTenantSlug)}`;

    const remainingTimeoutMs = Math.max(
      1200,
      GOOGLE_SHOPPING_TIMEOUT_MS - (Date.now() - startTime)
    );

    const prodRes = await withSeoTimeout(
      Promise.resolve(
        supabaseAdmin
          .from("products")
          .select(
            "id, internal_code, barcode, name, manufacturer, description, price, original_price, promotional_price, stock, image, requires_prescription"
          )
          .eq("tenant_id", tenant.id)
          .gt("stock", 0)
          .gt("price", 0)
          .not("image", "is", null)
          .or("requires_prescription.is.null,requires_prescription.eq.false")
          .limit(5000)
      ),
      remainingTimeoutMs
    );

    if (!prodRes) {
      return res.status(200).send(buildEmptyMerchantFeedXml(storeName, channelLink));
    }

    const rows = Array.isArray((prodRes as any).data) ? (prodRes as any).data : [];
    const seenIds = new Set<string>();
    const itemsXml: string[] = [];

    for (const prod of rows) {
      if (!prod) continue;
      if (prod.requires_prescription === true) continue;
      if (Number(prod.stock ?? 0) <= 0) continue;

      const title = sanitizeXmlText(prod.name, 150);
      if (!title) continue;

      const imageLink = resolveValidMerchantImageUrl(prod.image);
      if (!imageLink) continue;

      const { normalPrice, salePrice } = resolveMerchantPrices(prod);
      if (normalPrice <= 0) continue;

      const itemId = sanitizeXmlText(String(prod.internal_code || prod.id || ""), 50);
      if (!itemId || seenIds.has(itemId)) continue;
      seenIds.add(itemId);

      const pSlug = buildSeoProductSlug(prod);
      if (!pSlug) continue;

      const productUrl = isStoreHost
        ? `${baseUrl}/produto/${encodeURIComponent(pSlug)}?origem=google_shopping`
        : `${baseUrl}/loja/${encodeURIComponent(cleanTenantSlug)}/produto/${encodeURIComponent(pSlug)}?origem=google_shopping`;

      const rawDesc = sanitizeXmlText(prod.description || "", 5000);
      const fallbackDesc = cityState
        ? `${title} disponível para entrega rápida na ${storeName} - ${cityState}`
        : `${title} disponível para entrega rápida na ${storeName}`;
      const description = rawDesc.length >= 10 ? rawDesc : sanitizeXmlText(fallbackDesc, 5000);

      const brand = sanitizeXmlText(prod.manufacturer || "", 70) || sanitizeXmlText(storeName, 70);
      const validGtin = isValidGtinCode(prod.barcode);

      const lines = [
        "    <item>",
        `      <g:id>${escapeXml(itemId)}</g:id>`,
        `      <g:title>${escapeXml(title)}</g:title>`,
        `      <g:description>${escapeXml(description)}</g:description>`,
        `      <g:link>${escapeXml(productUrl)}</g:link>`,
        `      <g:image_link>${escapeXml(imageLink)}</g:image_link>`,
        "      <g:availability>in_stock</g:availability>",
        "      <g:condition>new</g:condition>",
        `      <g:price>${normalPrice.toFixed(2)} BRL</g:price>`,
      ];

      if (salePrice !== null && salePrice > 0 && salePrice < normalPrice) {
        lines.push(`      <g:sale_price>${salePrice.toFixed(2)} BRL</g:sale_price>`);
      }

      lines.push(`      <g:brand>${escapeXml(brand)}</g:brand>`);

      if (validGtin) {
        lines.push(`      <g:gtin>${escapeXml(validGtin)}</g:gtin>`);
        lines.push("      <g:identifier_exists>yes</g:identifier_exists>");
      } else {
        lines.push("      <g:identifier_exists>no</g:identifier_exists>");
      }

      lines.push("    </item>");
      itemsXml.push(lines.join("\n"));
    }

    const channelDesc = cityState
      ? `Catálogo oficial de produtos da ${storeName} (${cityState}) com entrega rápida.`
      : `Catálogo oficial de produtos da ${storeName} com entrega rápida.`;

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">',
      "  <channel>",
      `    <title>${escapeXml(storeName)}</title>`,
      `    <link>${escapeXml(channelLink)}</link>`,
      `    <description>${escapeXml(sanitizeXmlText(channelDesc, 300))}</description>`,
      ...itemsXml,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");

    if (googleShoppingRamCache.size > 300) {
      googleShoppingRamCache.clear();
    }
    googleShoppingRamCache.set(cacheKey, {
      xml,
      expiresAt: now + GOOGLE_SHOPPING_CACHE_TTL_MS,
    });

    return res.status(200).send(xml);
  } catch {
    return res.status(200).send(buildEmptyMerchantFeedXml("FarmaFlow", baseUrl));
  }
}

app.get("/google-shopping.xml", async (req, res) => {
  return handleGoogleShoppingFeedRequest(req, res);
});

app.get("/loja/:tenantSlug/google-shopping.xml", async (req, res) => {
  const tenantSlugParam = Array.isArray(req.params.tenantSlug)
    ? req.params.tenantSlug[0]
    : String(req.params.tenantSlug || "").trim();
  return handleGoogleShoppingFeedRequest(req, res, tenantSlugParam);
});

// Interceptor de Rota de Loja Pública (/loja/:slug, /loja/:slug/produto/:productSlug e /produto/:productSlug em subdomínios)
app.get(
  [
    "/loja/:slug/produto/:productSlug",
    "/loja/:slug",
    "/loja/:slug/*all",
    "/produto/:productSlug",
    "/produto/:productSlug/*all",
  ],
  async (req, res, next) => {
    if (!acceptsHtmlForSeo(req)) return next();

    const htmlFromRam = getIndexHtmlFromRam();

    try {
      const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : String(req.params.slug || "");
      const { host } = resolveRequestOrigin(req);
      const lowerHost = host.toLowerCase();
      const reservedSubdomains = ["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"];
      const isSubdomain =
        (lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
        !reservedSubdomains.includes(lowerHost.split(".")[0]);
      const isMainRootHost =
        lowerHost === "farmaflow.online" ||
        lowerHost === "www.farmaflow.online" ||
        lowerHost === "nexoia.online" ||
        lowerHost === "farmaflow.nexoia.online" ||
        lowerHost === "localhost" ||
        lowerHost === "127.0.0.1" ||
        lowerHost.includes("run.app");
      const hostTenantIdentifier = isSubdomain
        ? lowerHost.split(".")[0]
        : !isMainRootHost
          ? lowerHost
          : "";
      const identifier = slug || hostTenantIdentifier;
      const ua = String(req.headers["user-agent"] || "");
      const isSocialOnly = isSocialPreviewBot(ua);

      if (identifier) {
        const meta = await withSeoTimeout(getTenantMetaRecord(identifier, req), SEO_LOOKUP_TIMEOUT_MS);

        if (meta) {
          const seoInjectedHeader = meta.ogType === "product" ? "product" : "store";
          res.setHeader("X-SEO-Injected", seoInjectedHeader);

          if (isSocialOnly) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0");
            res.setHeader("CDN-Cache-Control", "no-store");
            res.setHeader("Vercel-CDN-Cache-Control", "no-store");
            return res.status(200).send(generateStoreOpenGraphHtml(meta));
          }

          if (htmlFromRam) {
            const injected = injectStoreMetaIntoHtml(htmlFromRam, meta);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            return res.status(200).send(injected);
          }
        }
      }

      if (htmlFromRam) {
        res.setHeader("X-SEO-Injected", "fallback");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.status(200).send(htmlFromRam);
      }
      return next();
    } catch {
      if (htmlFromRam) {
        res.setHeader("X-SEO-Injected", "fallback");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.status(200).send(htmlFromRam);
      }
      return next();
    }
  }
);

// Interceptor de Rota Raiz (/) para Lojas em Subdomínio, Parâmetros (?store/?loja/?produto) e Crawlers
app.get("/", async (req, res, next) => {
  if (!acceptsHtmlForSeo(req)) return next();

  const htmlFromRam = getIndexHtmlFromRam();

  try {
    const ua = String(req.headers["user-agent"] || "");
    const isSocialOnly = isSocialPreviewBot(ua);
    const storeParam = String(req.query.store || req.query.loja || req.query.tenant || req.query.p || "").trim();
    const { host } = resolveRequestOrigin(req);
    const lowerHost = host.toLowerCase();
    const isSubdomain =
      (lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
      !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(lowerHost.split(".")[0]);

    const identifier = storeParam || (isSubdomain ? lowerHost.split(".")[0] : "");
    if (identifier) {
      const meta = await withSeoTimeout(getTenantMetaRecord(identifier, req), SEO_LOOKUP_TIMEOUT_MS);
      if (meta) {
        res.setHeader("X-SEO-Injected", meta.ogType === "product" ? "product" : "store");
        if (isSocialOnly) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0");
          res.setHeader("CDN-Cache-Control", "no-store");
          res.setHeader("Vercel-CDN-Cache-Control", "no-store");
          return res.status(200).send(generateStoreOpenGraphHtml(meta));
        }

        if (htmlFromRam) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          return res.status(200).send(injectStoreMetaIntoHtml(htmlFromRam, meta));
        }
      }

      if (htmlFromRam && !isSocialOnly) {
        res.setHeader("X-SEO-Injected", "fallback");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return res.status(200).send(htmlFromRam);
      }
    }
    return next();
  } catch {
    if (htmlFromRam) {
      res.setHeader("X-SEO-Injected", "fallback");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.status(200).send(htmlFromRam);
    }
    return next();
  }
});

// Fast Storefront Initialization Endpoint
app.get("/api/v1/store/:tenantId/init", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;

    const tenantRes = await supabase.from("tenants").select("*").eq("id", tenantId).single();
    if (tenantRes.error) throw tenantRes.error;

    const tenant = tenantRes.data;
    const networkId = tenant?.network_id;

    let promoQuery = supabase.from("promotions").select("*");
    if (networkId) {
      promoQuery = promoQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      promoQuery = promoQuery.eq("tenant_id", tenantId);
    }

    let couponsQuery = supabase.from("coupons").select("*");
    if (networkId) {
      couponsQuery = couponsQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      couponsQuery = couponsQuery.eq("tenant_id", tenantId);
    }

    // Parallel fetch of remaining critical configuration and first subset of products
    const [promoRes, couponsRes, productsRes, gatewaysRes] = await Promise.all([
      promoQuery,
      couponsQuery,
      supabase
        .from("products")
        .select("id, tenant_id, internal_code, barcode, name, active_principle, drug_type, manufacturer, presentation, price, original_price, promotional_price, stock, category, grouping_slug, variant_attribute, image, is_featured, requires_prescription, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, video_uri, description, indications, usage, side_effects, contraindications, is_ai_enriched")
        .eq("tenant_id", tenantId)
        .gt("price", 0)
        .order("is_featured", { ascending: false })
        .limit(50),
      supabase
        .from("tenant_payment_gateways")
        .select("gateway_name, is_active, credentials")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
    ]);

    if (tenantRes.error) throw tenantRes.error;

    // Filter sensitive credentials out for public init endpoint
    const safeGateways = (gatewaysRes.data || []).map((gw: any) => {
      const publicCreds: any = {};
      if (gw.gateway_name === "stripe") {
        const pk = gw.credentials?.publishableKey || gw.credentials?.publishable_key;
        if (pk) {
          publicCreds.publishableKey = pk;
          publicCreds.publishable_key = pk;
        }
      }
      if (gw.gateway_name === "mercado_pago") {
        const pk = gw.credentials?.publicKey || gw.credentials?.public_key;
        if (pk) {
          publicCreds.publicKey = pk;
          publicCreds.public_key = pk;
        }
      }
      // other gateways... if needed
      
      return {
        gateway_name: gw.gateway_name,
        is_active: gw.is_active,
        credentials: publicCreds
      };
    });





    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    
    res.json({
      tenant: tenantRes.data,
      promotions: promoRes.data || [],
      coupons: couponsRes.data || [],
      products: productsRes.data || [],
      paymentGateways: safeGateways
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Ensure Service-Worker-Allowed header is set for all /sw.js requests
app.get("/sw.js", (req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  const publicSw = path.resolve(process.cwd(), "public/sw.js");
  if (fs.existsSync(publicSw)) {
    return res.sendFile(publicSw);
  }
  const distSw = path.resolve(process.cwd(), "dist/sw.js");
  if (fs.existsSync(distSw)) {
    return res.sendFile(distSw);
  }
  return res.send("// sw fallback\nself.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', () => self.clients.claim());");
});

// Dynamic PWA manifest route to prevent collisions of multiple shops on the same domain
// and differentiate between Customer Storefront (Loja Online) and Merchant Admin Panel (Painel de Gestão)
app.get(["/api/v1/manifest/:tenantId", "/manifest.json"], async (req, res) => {
  try {
    const rawParam = req.params.tenantId;
    const rawQueryTenant = (req.query.tenant as string) || (req.query.tenantId as string) || (req.query.p as string);
    let tenantQueryValue = (rawParam && rawParam !== "admin" && rawParam !== "default") ? rawParam : rawQueryTenant;

    if (!tenantQueryValue) {
      const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(":")[0].toLowerCase();
      if ((host.endsWith(".farmaflow.online") || host.endsWith(".nexoia.online")) && !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(host.split(".")[0])) {
        tenantQueryValue = host.split(".")[0];
      }
    }

    let tenantData: any = null;

    if (typeof tenantQueryValue === "string") {
      const cleanedQuery = tenantQueryValue.replace(/[^a-zA-Z0-9\-_]/g, "");
      if (cleanedQuery) {
        tenantData = await getTenantCachedOrFetch(cleanedQuery);
      }
    }

    // Determine if request comes from administrative context (Lojista / Painel Gestão)
    const isExplicitAdmin = 
      req.query.context === "admin" || 
      req.query.mode === "admin" || 
      req.query.admin === "true" || 
      req.query.scope === "admin" ||
      rawParam === "admin";

    const referer = ((req.headers.referer || req.headers.referrer || "") as string).toLowerCase();
    const isRefererAdmin = Boolean(
      referer && (referer.includes("/admin") || referer.includes("/login"))
    );

    const isAdmin = Boolean(isExplicitAdmin || isRefererAdmin);

    const name = tenantData?.name || "FarmaFlow AI";
    const primaryColor = tenantData?.primary_color || tenantData?.primarycolor || "#059669";
    const segment = tenantData?.slug || tenantData?.id || "default";
    const resolvedLogo = (tenantData?.logo_url || tenantData?.logo || "").trim();
    const iconType = resolvedLogo ? detectOgImageType(resolvedLogo) : "image/svg+xml";

    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (isAdmin) {
      // --- MANIFESTO ADMINISTRATIVO (Lojista / Gestão / Retaguarda / Caixa) ---
      const adminName = tenantData?.name ? `${tenantData.name} - Gestão` : "FarmaFlow Gestão";
      const adminShortName = tenantData?.name ? `${tenantData.name.slice(0, 12)} Gestão` : "Painel Gestão";
      const adminStartUrl = segment !== "default" ? `/admin?tenant=${segment}` : "/admin";
      const adminId = segment !== "default" ? `/admin/${segment}` : "/admin";

      return res.json({
        id: adminId,
        name: adminName,
        short_name: adminShortName,
        description: `Painel de Gestão e Administração da ${tenantData?.name || "Farmácia"} - FarmaFlow`,
        start_url: adminStartUrl,
        scope: "/",
        display: "standalone",
        launch_handler: {
          client_mode: ["navigate-existing", "auto"]
        },
        background_color: "#f8fafc",
        theme_color: primaryColor,
        icons: [
          {
            src: resolvedLogo || "/icon-192.svg",
            sizes: "192x192",
            type: resolvedLogo ? iconType : "image/svg+xml",
            purpose: "any maskable"
          },
          {
            src: resolvedLogo || "/icon-512.svg",
            sizes: "512x512",
            type: resolvedLogo ? iconType : "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      });
    }

    // --- MANIFESTO DO CLIENTE FINAL (Loja Online / Vitrine de Compras) ---
    res.json({
      id: segment === "default" ? "/?tenant=default" : `/loja/${segment}/`,
      name: name,
      short_name: name,
      description: `Compre online na ${name}`,
      start_url: segment === "default" ? "/" : `/loja/${segment}/`,
      scope: "/",
      display: "standalone",
      launch_handler: {
        client_mode: ["navigate-existing", "auto"]
      },
      background_color: "#fcfdfe",
      theme_color: primaryColor,
      icons: [
        {
          src: resolvedLogo || "/icon-192.svg",
          sizes: "192x192",
          type: resolvedLogo ? iconType : "image/svg+xml",
          purpose: "any maskable"
        },
        {
          src: resolvedLogo || "/icon-512.svg",
          sizes: "512x512",
          type: resolvedLogo ? iconType : "image/svg+xml",
          purpose: "any maskable"
        }
      ]
    });
  } catch (err: any) {
    const rawParam = req.params.tenantId;
    const isExplicitAdmin = 
      req.query.context === "admin" || 
      req.query.mode === "admin" || 
      req.query.admin === "true" || 
      rawParam === "admin";
    const referer = ((req.headers.referer || req.headers.referrer || "") as string).toLowerCase();
    const isRefererAdmin = Boolean(
      referer && (referer.includes("/admin") || referer.includes("/login"))
    );
    const isAdmin = Boolean(isExplicitAdmin || isRefererAdmin);

    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    if (isAdmin) {
      return res.json({
        id: "/admin",
        name: "FarmaFlow Gestão",
        short_name: "Painel Gestão",
        description: "Painel de Gestão e Administração FarmaFlow",
        start_url: "/admin",
        scope: "/",
        display: "standalone",
        launch_handler: {
          client_mode: ["navigate-existing", "auto"]
        },
        background_color: "#f8fafc",
        theme_color: "#059669",
        icons: [
          {
            src: "/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml"
          },
          {
            src: "/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml"
          }
        ]
      });
    }

    res.json({
      id: "/?tenant=default",
      name: "FarmaFlow AI",
      short_name: "FarmaFlow",
      description: "Plataforma de Farmácias Online",
      start_url: "/",
      scope: "/",
      display: "standalone",
      launch_handler: {
        client_mode: ["navigate-existing", "auto"]
      },
      background_color: "#fcfdfe",
      theme_color: "#3B82F6",
      icons: [
        {
          src: "/icon-192.svg",
          sizes: "192x192",
          type: "image/svg+xml"
        },
        {
          src: "/icon-512.svg",
          sizes: "512x512",
          type: "image/svg+xml"
        }
      ]
    });
  }
});

// Migrate legacy owners to Supabase Auth so they get a valid JWT
app.post("/api/v1/auth/migrate-legacy", async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    
    // Check if the credentials are valid using the admin_login rpc securely from the server
    const { data: rpcTenant, error: rpcError } = await supabase.rpc('admin_login', {
        input_email: email,
        input_password: password
    });

    if (rpcError || !rpcTenant || rpcTenant.id !== tenantId) {
       return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            tenant_id: tenantId,
            role: 'owner'
        }
    });

    // If error is because user already exists, we could just update their password/metadata to match
    if (createError) {
        if (createError.message.includes("already registered") || createError.message.includes("Email exists")) {
            return res.json({ success: true, message: "User exists, migration skipped or updated." });
        }
        throw createError;
    }
    
    // Create their record in tenant_users just in case they don't have one
    await supabase.from("tenant_users").insert({
        supabase_user_id: userData.user.id,
        tenant_id: tenantId,
        name: 'Proprietário',
        email: email,
        role: 'owner'
    });

    res.json({ success: true, data: userData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Team Management Endpoints
// =========================================
// MÓDULO DE GESTÃO DE USUÁRIOS (RBAC) - FARMAFLOW
// =========================================

app.get("/api/v1/team/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.query.tenantId; // Assume passed via header or query
    
    let query = supabase.from("tenant_users").select("*");
    
    if (tenantId) {
       query = query.eq("tenant_id", tenantId);
    }
    
    const { data: users, error } = await query.order("created_at", { ascending: false });
    
    if (error) throw error;

    const enrichedData = (users || []).map(u => ({
        id: u.id,
        supabase_user_id: u.supabase_user_id,
        full_name: u.name,
        email: u.email,
        role: u.role,
        store_id: u.tenant_id,
        is_active: u.is_active !== undefined ? u.is_active : true,
        created_at: u.created_at || null
    }));

    res.json({ data: enrichedData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Roles estritamente permitidas para cadastro e gestão por estabelecimentos (lojas)
const CHAT_ONLY_ROLE_ALIASES = ["chat_agent", "chat_only", "atendente_chat", "atendente de chat"];
const OPERATOR_LIKE_ROLES = ["operador", "operator", "atendente", "balconista", ...CHAT_ONLY_ROLE_ALIASES];
const STORE_ALLOWED_OPERATIONAL_ROLES = ["gerente", "operador", "balconista", "chat_agent", "chat_only", "atendente_chat"];

function normalizeStoreOperationalRole(role?: unknown): string {
  const clean = String(role || "").trim().toLowerCase();
  if (CHAT_ONLY_ROLE_ALIASES.includes(clean)) return "chat_agent";
  return clean;
}

function isRestrictedChatOperatorRole(role?: unknown): boolean {
  const clean = String(role || "").trim().toLowerCase();
  return OPERATOR_LIKE_ROLES.includes(clean);
}

const requireNonRestrictedChatAdmin = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers["authorization"] as string | undefined;
    const headerUserId = (req.headers["x-user-id"] as string | undefined)?.trim();
    const headerUserRole = (req.headers["x-user-role"] as string | undefined)?.trim();
    const queryUserId = (req.query?.userId as string | undefined)?.trim();
    const queryUserRole = (req.query?.role as string | undefined)?.trim();
    const bodyUserRole = (req.body?.userRole as string | undefined)?.trim();

    let resolvedRole = "";
    const candidateIds: string[] = [];
    const candidateEmails: string[] = [];

    const cleanAuthToken = authHeader ? String(authHeader).replace(/^Bearer\s+/i, "").trim() : "";
    if (cleanAuthToken && cleanAuthToken !== "undefined" && cleanAuthToken !== "null") {
      try {
        const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(cleanAuthToken);
        if (authUser) {
          if (authUser.id) candidateIds.push(authUser.id);
          if (authUser.email) candidateEmails.push(authUser.email.toLowerCase().trim());
          if (authUser.user_metadata?.role) {
            resolvedRole = String(authUser.user_metadata.role).toLowerCase().trim();
          }
        }
      } catch (_) {}
    }

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (headerUserId && uuidPattern.test(headerUserId)) candidateIds.push(headerUserId);
    if (queryUserId && uuidPattern.test(queryUserId)) candidateIds.push(queryUserId);

    if (candidateIds.length > 0 || candidateEmails.length > 0) {
      try {
        if (candidateIds.length > 0) {
          const { data: tuById } = await supabaseAdmin
            .from("tenant_users")
            .select("role")
            .or(`id.in.(${candidateIds.join(",")}),supabase_user_id.in.(${candidateIds.join(",")})`)
            .limit(1)
            .maybeSingle();
          if (tuById?.role) {
            resolvedRole = String(tuById.role).toLowerCase().trim();
          }
        }
        if (!resolvedRole && candidateEmails.length > 0) {
          const { data: tuByEmail } = await supabaseAdmin
            .from("tenant_users")
            .select("role")
            .ilike("email", candidateEmails[0])
            .limit(1)
            .maybeSingle();
          if (tuByEmail?.role) {
            resolvedRole = String(tuByEmail.role).toLowerCase().trim();
          }
        }
      } catch (_) {}
    }

    if (!resolvedRole) {
      resolvedRole = String(headerUserRole || queryUserRole || bodyUserRole || "").toLowerCase().trim();
    }

    if (isRestrictedChatOperatorRole(resolvedRole)) {
      return res.status(403).json({
        error: "Acesso negado: este perfil não tem permissão para gerenciar instâncias de WhatsApp, equipes ou caixas de entrada."
      });
    }

    return next();
  } catch (err) {
    console.warn("[requireNonRestrictedChatAdmin] Erro ao validar permissão:", err);
    return next();
  }
};

app.post("/api/v1/team/users", checkTenantAccess, async (req, res) => {
  try {
    const { email, password, full_name, role, store_id } = req.body;
    
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "Nome, e-mail, função e senha são obrigatórios." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const rawCleanRole = String(role).trim().toLowerCase();
    const cleanStoreId = store_id || req.headers["x-tenant-id"] || req.query.tenantId;

    // Validação de Segurança RBAC: Lojas só podem cadastrar colaboradores com papéis operacionais
    if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(rawCleanRole)) {
      return res.status(403).json({ 
        error: "Permissão negada: As lojas podem cadastrar apenas colaboradores operacionais (Gerente, Operador/Balconista ou Atendente de Chat). Cargos administrativos/matriz são de exclusividade do Super Admin." 
      });
    }
    const cleanRole = normalizeStoreOperationalRole(rawCleanRole);

    let authUserId = "";
    
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: cleanRole,
        store_id: cleanStoreId,
        tenant_id: cleanStoreId
      }
    });

    if (error) {
      if (error.message.includes("already been registered") || error.message.includes("already registered") || error.status === 422) {
         // Tentar encontrar o usuário existente
         const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
         const existingUser = existingUsers?.users?.find((u: any) => u.email?.toLowerCase() === cleanEmail);
         
         if (existingUser) {
            authUserId = existingUser.id;
            
            // Verifica se já está no tenant_users
            const { data: existingTenantUser } = await supabaseAdmin
              .from("tenant_users")
              .select("id")
              .eq("supabase_user_id", authUserId)
              .eq("tenant_id", cleanStoreId)
              .single();
              
            if (existingTenantUser) {
               return res.status(400).json({ error: "Este usuário já faz parte da sua equipe." });
            }
         } else {
            return res.status(400).json({ error: "Este endereço de e-mail já está sendo utilizado por outro usuário no sistema." });
         }
      } else {
        console.error("[Team API] Erro ao criar usuário auth:", error);
        
        // Verifica se o erro pode ser falta de permissão (Service Role Key ausente)
        if (error.message.includes("not allowed") || error.status === 401 || error.status === 403) {
            return res.status(400).json({ error: "Erro de permissão no Supabase. Verifique se a variável SUPABASE_SERVICE_ROLE_KEY está configurada no painel." });
        }
        
        return res.status(400).json({ error: error.message });
      }
    } else {
      authUserId = user.user.id;
    }
    
    // Inserir no tenant_users
    const { error: userError } = await supabaseAdmin
      .from("tenant_users")
      .insert({
        supabase_user_id: authUserId,
        tenant_id: cleanStoreId,
        name: full_name,
        email: cleanEmail,
        role: cleanRole,
        is_active: true
      });

    if (userError) {
       console.error("[Team API] Erro ao inserir no tenant_users:", userError);
       return res.status(400).json({ error: "Erro de banco de dados ao salvar o funcionário. Detalhes: " + (userError.message || JSON.stringify(userError)) });
    }

    return res.status(201).json({ success: true, user });
  } catch (error: any) {
    console.error("[Team API] Erro interno:", error);
    return res.status(500).json({ error: "Erro interno: " + error.message });
  }
});

app.patch("/api/v1/team/users/:id", checkTenantAccess, async (req, res) => {
  try {
    const userId = String(req.params.id || "").trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      return res.status(400).json({ error: "ID de usuário inválido (UUID esperado)." });
    }
    const { full_name, role, is_active } = req.body;

    let cleanRole: string | undefined = undefined;
    if (role !== undefined && role !== null) {
      const rawRole = String(role).trim().toLowerCase();
      if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(rawRole)) {
        return res.status(403).json({ 
          error: "Permissão negada: As lojas podem atribuir apenas cargos operacionais (Gerente, Operador/Balconista ou Atendente de Chat)." 
        });
      }
      cleanRole = normalizeStoreOperationalRole(rawRole);
    }

    const updatePayload: any = {};
    if (full_name !== undefined) updatePayload.name = full_name;
    if (cleanRole !== undefined) updatePayload.role = cleanRole;
    if (is_active !== undefined) updatePayload.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from("tenant_users")
      .update(updatePayload)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    
    if (data && data.supabase_user_id) {
       await supabaseAdmin.auth.admin.updateUserById(data.supabase_user_id, {
          user_metadata: { role: data.role, full_name: data.name },
          ban_duration: data.is_active ? 'none' : '876000h'
       });
    }

    return res.json({ data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/team/users/:id", checkTenantAccess, async (req, res) => {
  try {
    const userId = String(req.params.id || "").trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      return res.status(400).json({ error: "ID de usuário inválido (UUID esperado)." });
    }
    const tenantId = (req.headers["x-tenant-id"] || req.query.tenantId) as string;

    // 1. Busca dados do usuário para identificar vínculos
    const { data: userRecord } = await supabaseAdmin
      .from("tenant_users")
      .select("id, supabase_user_id, tenant_id")
      .eq("id", userId)
      .maybeSingle();

    // 2. Remove o registro da tabela tenant_users
    let deleteQuery = supabaseAdmin.from("tenant_users").delete().eq("id", userId);
    if (tenantId) {
      deleteQuery = deleteQuery.eq("tenant_id", tenantId);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
      console.error("[Team API] Erro ao excluir de tenant_users:", deleteError);
      return res.status(400).json({ error: deleteError.message || "Erro ao excluir membro da equipe no banco de dados." });
    }

    // 3. Limpeza de vínculos em equipes e caixas de entrada
    try {
      await supabaseAdmin.from("chat_inbox_members").delete().eq("user_id", userId);
      await supabaseAdmin.from("chat_team_members").delete().eq("user_id", userId);
      if (userRecord?.supabase_user_id) {
        await supabaseAdmin.from("chat_inbox_members").delete().eq("user_id", userRecord.supabase_user_id);
        await supabaseAdmin.from("chat_team_members").delete().eq("user_id", userRecord.supabase_user_id);
      }
    } catch (cleanupErr: any) {
      console.warn("[Team API] Limpeza secundária de vínculos (aviso):", cleanupErr?.message);
    }

    // 4. Se tiver supabase_user_id e não pertencer a outras lojas, remove do Auth
    if (userRecord?.supabase_user_id) {
      try {
        const { count } = await supabaseAdmin
          .from("tenant_users")
          .select("id", { count: "exact", head: true })
          .eq("supabase_user_id", userRecord.supabase_user_id);

        if (!count || count === 0) {
          await supabaseAdmin.auth.admin.deleteUser(userRecord.supabase_user_id);
        }
      } catch (authErr: any) {
        console.warn("[Team API] Aviso ao remover do Supabase Auth:", authErr?.message);
      }
    }

    return res.json({ success: true, message: "Usuário excluído com sucesso." });
  } catch (e: any) {
    console.error("[Team API] Erro na exclusão de usuário:", e);
    return res.status(500).json({ error: e.message || "Erro interno ao excluir usuário." });
  }
});

// =========================================
// MÓDULO DE EQUIPES (TEAMS)
// =========================================
app.get("/api/v1/teams", async (req, res) => {
  try {
    const storeId = (req.query.storeId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const data = await teamStore.getTeams(storeId);
    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/teams", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { store_id, name, description } = req.body;
    const storeId = store_id || (req.headers["x-tenant-id"] as string) || "default";
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
    
    const data = await teamStore.createTeam(storeId, name, description);
    return res.status(201).json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/v1/teams/:id", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
    
    const data = await teamStore.updateTeam(id, name, description);
    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/teams/:id", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await teamStore.deleteTeam(id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/teams/:id/members", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await teamStore.getMembers(id);
    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/teams/:id/members/toggle", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId é obrigatório" });
    
    const data = await teamStore.toggleMember(id, userId);
    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================
// MÓDULO DE CAIXAS DE ENTRADA (INBOXES)
// =========================================

// Helper robusto para resolver IDs autorizados de operadores em department_access e inbox_members
function normalizeDepartmentText(val?: unknown): string {
  return String(val || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

interface OperatorAccessContext {
  isOperator: boolean;
  allowedInboxIds: string[];
  allowedTeamIds: string[];
  allowedDepartmentNames: string[];
  operatorIdentifiers: string[];
  operatorTenantIds: string[];
}

async function resolveOperatorAccessContext(
  storeId: string,
  userId?: string,
  userRole?: string,
  authHeader?: string,
  headerUserId?: string,
  headerUserRole?: string
): Promise<OperatorAccessContext> {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const candidateUserIds = new Set<string>();
  const candidateEmails = new Set<string>();
  const operatorTenantIds = new Set<string>();
  let hasSyntheticAdminSession = false;

  const addCandidate = (val?: string | null) => {
    if (!val || typeof val !== "string") return;
    const clean = val.trim();
    if (!clean || clean === "undefined" || clean === "null") return;
    if (/^admin_/i.test(clean)) {
      hasSyntheticAdminSession = true;
      return;
    }
    if (clean.includes("@")) {
      candidateEmails.add(clean.toLowerCase());
    } else {
      candidateUserIds.add(clean);
    }
  };

  addCandidate(userId);
  addCandidate(headerUserId);

  let detectedRole = (userRole || headerUserRole || "").toLowerCase().trim();
  const isExplicitAdminRole = [
    "admin",
    "super_admin",
    "superadmin",
    "owner",
    "proprietario",
    "gerente",
    "manager",
    "matriz",
    "admin_matriz",
    "network_admin"
  ].includes(detectedRole);

  // Para sessões sintéticas de administrador (admin_*), resolve acesso diretamente sem consultar tenant_users.id
  if (hasSyntheticAdminSession && (isExplicitAdminRole || !isRestrictedChatOperatorRole(detectedRole))) {
    return {
      isOperator: false,
      allowedInboxIds: [],
      allowedTeamIds: [],
      allowedDepartmentNames: [],
      operatorIdentifiers: [],
      operatorTenantIds: []
    };
  }

  let authoritativeRole = "";

  // 1. Tentar resolver a partir do token Bearer se fornecido
  const cleanAuthToken = authHeader ? String(authHeader).replace(/^Bearer\s+/i, "").trim() : "";
  if (cleanAuthToken && cleanAuthToken !== "undefined" && cleanAuthToken !== "null") {
    try {
      const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(cleanAuthToken);
      if (authUser) {
        addCandidate(authUser.id);
        if (authUser.email) addCandidate(authUser.email);
        if (authUser.user_metadata?.role) {
          authoritativeRole = String(authUser.user_metadata.role).toLowerCase().trim();
        }
      }
    } catch (_) {}
  }

  const candidateStoreIds = storeId && storeId !== "default"
    ? await resolveStoreCandidateIds(storeId)
    : [];

  // 2. Buscar correspondência em tenant_users (NUNCA filtrar tenant_users.id com strings não-UUID)
  try {
    const rawIds = Array.from(candidateUserIds);
    const validUuids = rawIds.filter((id) => UUID_REGEX.test(id));
    const rawEmails = Array.from(candidateEmails);

    const tuQueries: Promise<any>[] = [];

    if (rawEmails.length > 0) {
      for (const email of rawEmails) {
        tuQueries.push(
          Promise.resolve(
            supabaseAdmin
              .from("tenant_users")
              .select("id, supabase_user_id, role, tenant_id, email")
              .ilike("email", email)
          )
        );
      }
    }

    if (validUuids.length > 0) {
      tuQueries.push(
        Promise.resolve(
          supabaseAdmin
            .from("tenant_users")
            .select("id, supabase_user_id, role, tenant_id, email")
            .or(`id.in.(${validUuids.join(",")}),supabase_user_id.in.(${validUuids.join(",")})`)
        )
      );
    }

    if (candidateStoreIds.length > 0 && rawEmails.length > 0) {
      tuQueries.push(
        Promise.resolve(
          supabaseAdmin
            .from("tenant_users")
            .select("id, supabase_user_id, role, tenant_id, email")
            .in("tenant_id", candidateStoreIds)
        )
      );
    }

    const results = await Promise.all(tuQueries);
    for (const res of results) {
      if (res.data && Array.isArray(res.data)) {
        for (const tu of res.data) {
          const matchEmail = tu.email && rawEmails.includes(String(tu.email).toLowerCase().trim());
          const matchId = tu.id && rawIds.includes(String(tu.id));
          const matchSubId = tu.supabase_user_id && rawIds.includes(String(tu.supabase_user_id));

          if (matchEmail || matchId || matchSubId) {
            if (tu.id) addCandidate(tu.id);
            if (tu.supabase_user_id) addCandidate(tu.supabase_user_id);
            if (tu.email) addCandidate(tu.email);
            if (tu.tenant_id) operatorTenantIds.add(String(tu.tenant_id).trim());
            if (tu.role) {
              authoritativeRole = String(tu.role).toLowerCase().trim();
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[OperatorAccess] Error resolving tenant_users:", e);
  }

  if (authoritativeRole) {
    detectedRole = authoritativeRole;
  }

  const allSearchIdentifiers = Array.from(new Set([...candidateUserIds, ...candidateEmails]));
  const isOperator = isRestrictedChatOperatorRole(detectedRole);

  if (!isOperator) {
    return {
      isOperator: false,
      allowedInboxIds: [],
      allowedTeamIds: [],
      allowedDepartmentNames: [],
      operatorIdentifiers: allSearchIdentifiers,
      operatorTenantIds: Array.from(operatorTenantIds)
    };
  }

  const allowedIdsSet = new Set<string>();
  const allowedTeamIdsSet = new Set<string>();
  const allowedDeptNamesSet = new Set<string>();

  if (allSearchIdentifiers.length > 0) {
    // 3. Buscar em department_access
    try {
      const { data: deptRows, error: deptErr } = await supabaseAdmin
        .from("department_access")
        .select("department_id, user_id, tenant_id")
        .in("user_id", allSearchIdentifiers);
      if (!deptErr && deptRows) {
        deptRows.forEach((r: any) => {
          if (r.department_id) {
            const deptVal = String(r.department_id).trim();
            if (UUID_REGEX.test(deptVal)) {
              allowedIdsSet.add(deptVal);
            } else if (deptVal) {
              allowedDeptNamesSet.add(normalizeDepartmentText(deptVal));
            }
          }
          if (r.tenant_id) operatorTenantIds.add(String(r.tenant_id).trim());
        });
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying department_access:", e);
    }

    // 4. Buscar em inbox_members
    try {
      const { data: memberRows, error: memErr } = await supabaseAdmin
        .from("inbox_members")
        .select("inbox_id, user_id")
        .in("user_id", allSearchIdentifiers);
      if (!memErr && memberRows) {
        memberRows.forEach((r: any) => {
          if (r.inbox_id) allowedIdsSet.add(String(r.inbox_id).trim());
        });
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying inbox_members:", e);
    }

    // 5. Buscar em chat_team_members (e fallback team_members caso exista)
    try {
      const { data: teamRows, error: teamErr } = await supabaseAdmin
        .from("chat_team_members")
        .select("team_id, user_id")
        .in("user_id", allSearchIdentifiers);
      if (!teamErr && teamRows) {
        teamRows.forEach((r: any) => {
          if (r.team_id) allowedTeamIdsSet.add(String(r.team_id).trim());
        });
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying chat_team_members:", e);
    }

    try {
      const { data: altTeamRows, error: altTeamErr } = await supabaseAdmin
        .from("team_members")
        .select("team_id, user_id")
        .in("user_id", allSearchIdentifiers);
      if (!altTeamErr && altTeamRows) {
        altTeamRows.forEach((r: any) => {
          if (r.team_id) allowedTeamIdsSet.add(String(r.team_id).trim());
        });
      }
    } catch (_) {}

    // 6. Buscar em inboxStore (memória / cache local de membros)
    try {
      const storeInboxes = await inboxStore.getInboxes(storeId);
      for (const ib of storeInboxes) {
        const members = await inboxStore.getMembers(ib.id);
        if (members && members.some((m) => allSearchIdentifiers.includes(m))) {
          allowedIdsSet.add(ib.id);
        }
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying inboxStore members:", e);
    }

    // 7. Expandir inboxes vinculados aos times do operador via inbox_teams
    const teamIdsArr = Array.from(allowedTeamIdsSet).filter((id) => UUID_REGEX.test(id));
    if (teamIdsArr.length > 0) {
      try {
        const { data: inboxTeamRows } = await supabaseAdmin
          .from("inbox_teams")
          .select("inbox_id, team_id")
          .in("team_id", teamIdsArr);
        if (Array.isArray(inboxTeamRows)) {
          inboxTeamRows.forEach((row: any) => {
            if (row.inbox_id) allowedIdsSet.add(String(row.inbox_id).trim());
          });
        }
      } catch (_) {}

      try {
        const { data: teamMetaRows } = await supabaseAdmin
          .from("chat_teams")
          .select("id, name")
          .in("id", teamIdsArr);
        if (Array.isArray(teamMetaRows)) {
          teamMetaRows.forEach((t: any) => {
            if (t.name) allowedDeptNamesSet.add(normalizeDepartmentText(t.name));
          });
        }
      } catch (_) {}
    }

    // 8. Resolver nomes de departamentos das caixas permitidas e sincronizar correspondência case-insensitive
    const effectiveStoreCandidates = new Set<string>(candidateStoreIds);
    for (const opTid of operatorTenantIds) {
      const resolved = await resolveStoreCandidateIds(opTid);
      resolved.forEach((id) => effectiveStoreCandidates.add(id));
    }

    try {
      const storeIdsList = Array.from(effectiveStoreCandidates);
      let storeInboxRows: any[] = [];
      if (storeIdsList.length > 0) {
        const { data } = await supabaseAdmin
          .from("inboxes")
          .select("id, name, store_id")
          .in("store_id", storeIdsList);
        if (Array.isArray(data)) storeInboxRows = data;
      } else if (allowedIdsSet.size > 0) {
        const validIds = Array.from(allowedIdsSet).filter((id) => UUID_REGEX.test(id));
        if (validIds.length > 0) {
          const { data } = await supabaseAdmin
            .from("inboxes")
            .select("id, name, store_id")
            .in("id", validIds);
          if (Array.isArray(data)) storeInboxRows = data;
        }
      }

      for (const ib of storeInboxRows) {
        const normName = normalizeDepartmentText(ib.name);
        if (allowedIdsSet.has(ib.id) && normName) {
          allowedDeptNamesSet.add(normName);
        }
      }
      // Match case-insensitive entre department_access / time e o nome da caixa (ex.: "Vendas" === "vendas")
      for (const ib of storeInboxRows) {
        const normName = normalizeDepartmentText(ib.name);
        if (normName && allowedDeptNamesSet.has(normName)) {
          allowedIdsSet.add(ib.id);
        }
      }
    } catch (_) {}
  }

  return {
    isOperator: true,
    allowedInboxIds: Array.from(allowedIdsSet),
    allowedTeamIds: Array.from(allowedTeamIdsSet),
    allowedDepartmentNames: Array.from(allowedDeptNamesSet),
    operatorIdentifiers: allSearchIdentifiers,
    operatorTenantIds: Array.from(operatorTenantIds)
  };
}

async function resolveOperatorAllowedInboxIds(
  storeId: string,
  userId?: string,
  userRole?: string,
  authHeader?: string,
  headerUserId?: string,
  headerUserRole?: string
): Promise<{ isOperator: boolean; allowedInboxIds: string[] }> {
  const ctx = await resolveOperatorAccessContext(
    storeId,
    userId,
    userRole,
    authHeader,
    headerUserId,
    headerUserRole
  );
  return {
    isOperator: ctx.isOperator,
    allowedInboxIds: ctx.allowedInboxIds
  };
}

async function verifyOperatorConversationAccess(params: {
  storeId: string;
  conversationId: string;
  userId?: string;
  userRole?: string;
  authHeader?: string;
  headerUserId?: string;
  headerUserRole?: string;
  deniedErrorMessage?: string;
}): Promise<{ allowed: boolean; status?: number; error?: string; conversation?: any; context?: OperatorAccessContext }> {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const deniedMsg = params.deniedErrorMessage || "Permissão negada para enviar mensagens nesta conversa.";
  const ctx = await resolveOperatorAccessContext(
    params.storeId,
    params.userId,
    params.userRole,
    params.authHeader,
    params.headerUserId,
    params.headerUserRole
  );

  // Busca conversa no Supabase (com fallback para chatStore)
  let convData: any = null;
  try {
    const { data } = await supabaseAdmin
      .from("chat_conversations")
      .select("*")
      .eq("id", params.conversationId)
      .maybeSingle();
    convData = data || null;
  } catch (_) {}

  if (!convData) {
    try {
      convData = await chatStore.getConversationById(params.conversationId);
    } catch (_) {}
  }

  if (!convData) {
    return { allowed: true, conversation: null, context: ctx };
  }

  // Validação de isolamento de loja (resolvendo tenants.id e tenants.slug)
  const convStoreRaw = convData.store_id || convData.tenant_id || "";
  if (convStoreRaw && convStoreRaw !== "default") {
    const convStoreCandidates = new Set(
      (await resolveStoreCandidateIds(String(convStoreRaw))).map((s) => s.toLowerCase())
    );
    convStoreCandidates.add(String(convStoreRaw).trim().toLowerCase());

    if (ctx.operatorTenantIds.length > 0) {
      const opStoreCandidates = new Set<string>();
      for (const tid of ctx.operatorTenantIds) {
        const resolved = await resolveStoreCandidateIds(tid);
        resolved.forEach((s) => opStoreCandidates.add(s.toLowerCase()));
        opStoreCandidates.add(tid.trim().toLowerCase());
      }
      const sameStore = Array.from(opStoreCandidates).some((s) => convStoreCandidates.has(s));
      if (!sameStore) {
        return {
          allowed: false,
          status: 403,
          error: "Acesso negado: esta conversa pertence a outra loja.",
          conversation: convData,
          context: ctx
        };
      }
    }
  }

  if (!ctx.isOperator) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  // Condição 1: Conversa atribuída ao próprio operador
  const opIdsLower = new Set(ctx.operatorIdentifiers.map((id) => String(id).trim().toLowerCase()));
  const assignedValues: string[] = [];
  if (convData.assigned_user_id) assignedValues.push(String(convData.assigned_user_id).trim().toLowerCase());
  if (convData.assigned_to) assignedValues.push(String(convData.assigned_to).trim().toLowerCase());
  if (typeof convData.bot_handoff_reason === "string" && convData.bot_handoff_reason.startsWith("ASSIGNED:")) {
    const extracted = convData.bot_handoff_reason.slice("ASSIGNED:".length).trim().toLowerCase();
    if (extracted) assignedValues.push(extracted);
  }
  if (assignedValues.some((val) => opIdsLower.has(val))) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  // Condição 2: Operador possui acesso à Caixa de Entrada atual da conversa
  if (convData.inbox_id && ctx.allowedInboxIds.includes(String(convData.inbox_id).trim())) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  // Condição 3: Operador possui acesso ao Departamento / Setor / Time atual da conversa
  if (convData.team_id && ctx.allowedTeamIds.includes(String(convData.team_id).trim())) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  const convDeptNorm = normalizeDepartmentText(convData.department);
  if (convDeptNorm && ctx.allowedDepartmentNames.includes(convDeptNorm)) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  // Verifica ainda se a inbox da conversa possui nome compatível (case-insensitive) ou time vinculado ao operador
  if (convData.inbox_id && UUID_REGEX.test(String(convData.inbox_id).trim())) {
    try {
      const { data: convInboxRow } = await supabaseAdmin
        .from("inboxes")
        .select("id, name")
        .eq("id", String(convData.inbox_id).trim())
        .maybeSingle();
      if (convInboxRow?.name && ctx.allowedDepartmentNames.includes(normalizeDepartmentText(convInboxRow.name))) {
        return { allowed: true, conversation: convData, context: ctx };
      }
    } catch (_) {}

    if (ctx.allowedTeamIds.length > 0) {
      try {
        const { data: linkRows } = await supabaseAdmin
          .from("inbox_teams")
          .select("team_id")
          .eq("inbox_id", String(convData.inbox_id).trim());
        if (Array.isArray(linkRows) && linkRows.some((r: any) => ctx.allowedTeamIds.includes(String(r.team_id)))) {
          return { allowed: true, conversation: convData, context: ctx };
        }
      } catch (_) {}
    }
  }

  // Se a conversa não tem caixa nem departamento nem time definido e pertence à mesma loja do operador, permite acesso se operador tiver alguma caixa na loja
  if (!convData.inbox_id && !convData.team_id && !convDeptNorm && ctx.allowedInboxIds.length > 0) {
    return { allowed: true, conversation: convData, context: ctx };
  }

  return {
    allowed: false,
    status: 403,
    error: deniedMsg,
    conversation: convData,
    context: ctx
  };
}

app.get("/api/v1/inboxes", async (req, res) => {
  try {
    const storeId = (req.query.storeId as string) || (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || undefined;
    const userRole = (req.query.role as string) || (req.headers["x-user-role"] as string) || undefined;
    const authHeader = req.headers["authorization"] as string | undefined;
    const forTransfer = req.query.forTransfer === "true" || req.query.all === "true";

    let data = await inboxStore.getInboxes(storeId);

    // Se a requisição for para transferência entre departamentos, exibe todos os departamentos da loja/empresa
    if (!forTransfer) {
      const { isOperator, allowedInboxIds } = await resolveOperatorAllowedInboxIds(
        storeId,
        userId,
        userRole,
        authHeader,
        req.headers["x-user-id"] as string,
        req.headers["x-user-role"] as string
      );

      if (isOperator) {
        // REGRA ESTRITA DE OPERADOR:
        // Se for operador, retorna ESTRITAMENTE APENAS as caixas com vínculo explícito em department_access ou inbox_members.
        // Se não tiver nenhuma caixa vinculada (allowedInboxIds vazio), retorna array vazio ([]). NUNCA injeta outras caixas.
        data = data.filter(inbox => allowedInboxIds.includes(inbox.id));
      }
    }

    return res.json({ data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { store_id, name, description, whatsapp_instance_id, channel_type, channel_mode, channelMode } = req.body;
    const storeId = store_id || (req.headers["x-tenant-id"] as string) || "default";
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const resolvedMode: "shared" | "exclusive" =
      channel_mode === "exclusive" || channelMode === "exclusive" ? "exclusive" : "shared";

    const created = await inboxStore.createInbox(
      storeId,
      name,
      description,
      whatsapp_instance_id,
      channel_type,
      resolvedMode
    );
    return res.status(201).json({ data: created });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/v1/inboxes/:id", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { store_id, name, description, whatsapp_instance_id, channel_type, channel_mode, channelMode } = req.body;
    const storeId = store_id || (req.headers["x-tenant-id"] as string) || undefined;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const resolvedMode: "shared" | "exclusive" =
      channel_mode === "exclusive" || channelMode === "exclusive" ? "exclusive" : "shared";

    const updated = await inboxStore.updateInbox(
      id,
      name,
      description,
      whatsapp_instance_id,
      channel_type,
      { storeId, channelMode: resolvedMode }
    );
    return res.json({ data: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/inboxes/:id", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await inboxStore.deleteInbox(id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/inboxes/:id/members", async (req, res) => {
  try {
    const { id } = req.params;
    const members = await inboxStore.getMembers(id);
    return res.json({ data: members });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes/:id/members", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds, tenantId } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds deve ser um array." });

    const updatedMembers = await inboxStore.setMembers(id, userIds, tenantId);
    return res.json({ data: updatedMembers });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/v1/inboxes/:id/members", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds, tenantId } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "userIds deve ser um array." });

    const updatedMembers = await inboxStore.setMembers(id, userIds, tenantId);
    return res.json({ data: updatedMembers });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes/:id/members/toggle", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId é obrigatório" });

    const updatedMembers = await inboxStore.toggleMember(id, userId);
    return res.json({ data: updatedMembers });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/inboxes/:id/teams", async (req, res) => {
  try {
    const { id } = req.params;
    const teams = await teamStore.getInboxTeams(id);
    return res.json({ data: teams });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/inboxes/:id/teams", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { teamIds } = req.body;
    if (!Array.isArray(teamIds)) return res.status(400).json({ error: "teamIds deve ser um array." });
    const saved = await teamStore.setInboxTeams(id, teamIds);
    return res.json({ data: saved });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
app.get("/api/v1/tenants/:tenantId/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { data, error } = await supabase
      .from("tenant_users")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/users", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { name, email, role, password } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "Todos os campos (nome, e-mail, função e senha) são obrigatórios." });
    }

    const rawCleanRole = String(role).trim().toLowerCase();
    // Validação de Segurança RBAC: Apenas funções operacionais permitidas para estabelecimentos
    if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(rawCleanRole)) {
      return res.status(403).json({ 
        error: "Permissão negada: As lojas podem cadastrar apenas colaboradores operacionais (Gerente, Operador/Balconista ou Atendente de Chat). Cargos administrativos/matriz são de exclusividade do Super Admin." 
      });
    }
    const cleanRole = normalizeStoreOperationalRole(rawCleanRole);

    const cleanEmail = email.toLowerCase().trim();

    // 1. Preventative check: check if the email has already been registered in tenant_users (HTTP 409)
    try {
      const { data: existingUser, error: checkEmailError } = await supabase
        .from("tenant_users")
        .select("id")
        .eq("email", cleanEmail)
        .maybeSingle();

      if (checkEmailError) {
        console.error("Warning checking existing email in tenant_users:", checkEmailError);
      } else if (existingUser) {
        return res.status(409).json({ error: "Este endereço de e-mail já está sendo utilizado por outro membro da equipe." });
      }
    } catch (checkErr) {
      console.error("Exception checking existing email:", checkErr);
    }

    // Verify if tenant exists in tenants. Auto-create if missing to avoid foreign key violations.
    const { data: tenantRows, error: checkTenantError } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", tenantId);

    if (!checkTenantError && (!tenantRows || tenantRows.length === 0)) {
      console.log(`Auto-creating developer tenant row for ${tenantId}...`);
      await supabase
        .from("tenants")
        .insert({
          id: tenantId,
          name: "Developer Tenant",
          slug: tenantId,
          admin_email: "contato.nexoia@gmail.com",
          primarycolor: "#10b981",
          secondarycolor: "#059669",
          accentcolor: "#f59e0b",
          primary_color: "#10b981",
          secondary_color: "#059669",
          accent_color: "#f59e0b",
          isblocked: false,
          is_blocked: false,
          whatsapp: "550000000000"
        });
    }

    // 2. Create user in Auth using dedicated administrative client (supabaseAdmin)
    console.log(`Creating user in Auth with administrative client for email: ${cleanEmail}...`);
    let authData, authError;
    try {
      const resAuth = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: {
          tenant_id: tenantId,
          store_id: tenantId,
          role: cleanRole,
          full_name: name
        }
      });
      authData = resAuth.data;
      authError = resAuth.error;
    } catch (authCallErr: any) {
      console.error("Exception in admin.createUser process:", authCallErr);
      authError = authCallErr;
    }

    // Fallback if admin.createUser failed
    if (authError) {
      console.error("Admin user creation failed. Attempting signup fallback...", authError);
      
      // If of conflict type "email_exists", we should return a clean error without crashing
      if (authError.status === 422 || authError.message?.toLowerCase().includes("email_exists") || authError.message?.toLowerCase().includes("already registered")) {
        return res.status(409).json({ error: "Este e-mail de usuário já está registrado no sistema de autenticação." });
      }
      
      try {
        const signUpRes = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              tenant_id: tenantId,
              store_id: tenantId,
              role: cleanRole,
              full_name: name
            }
          }
        });
        
        if (signUpRes.error) {
           console.error("Signup fallback failed:", signUpRes.error);
           return res.status(400).json({ error: `Falha na criação de usuário: ${signUpRes.error.message}` });
        }
        
        authData = signUpRes.data;
      } catch (fallbackErr: any) {
        console.error("Exception in signup fallback call:", fallbackErr);
        return res.status(500).json({ error: `Falha total na autenticação: ${fallbackErr.message || "Erro desconhecido"}` });
      }
    }

    if (!authData || !authData.user) {
      return res.status(500).json({ error: "Provedor de autenticação não retornou informações do usuário." });
    }

    // 3. Create record in tenant_users table
    console.log(`Inserting tenant user record for ID: ${authData.user.id}...`);
    const { data: userData, error: userError } = await supabase
      .from("tenant_users")
      .insert({
        supabase_user_id: authData.user.id,
        tenant_id: tenantId,
        name,
        email: cleanEmail,
        role: cleanRole
      })
      .select()
      .single();

    if (userError) {
      console.error("Database schema insertion error:", userError);
      return res.status(400).json({ error: `Erro de sincronização local: ${userError.message}` });
    }

    return res.json({ data: userData });
  } catch (e: any) {
    console.error("Unhandled top-level crash inside users creation route:", e);
    return res.status(500).json({ error: `Erro inesperado na criação do membro: ${e.message || "Erro de Servidor"}` });
  }
});

app.patch("/api/v1/tenants/:tenantId/users/:userId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const userId = req.params.userId;
    const { name, role, is_active } = req.body;

    let cleanRole: string | undefined = undefined;
    if (role !== undefined && role !== null) {
      const rawRole = String(role).trim().toLowerCase();
      if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(rawRole)) {
        return res.status(403).json({ 
          error: "Permissão negada: As lojas podem atribuir apenas cargos operacionais (Gerente, Operador/Balconista ou Atendente de Chat)." 
        });
      }
      cleanRole = normalizeStoreOperationalRole(rawRole);
    }

    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (cleanRole !== undefined) updatePayload.role = cleanRole;
    if (is_active !== undefined) updatePayload.is_active = is_active;

    // Update in tenant_users
    const { data: userData, error: userError } = await supabase
      .from("tenant_users")
      .update(updatePayload)
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (userError) throw userError;

    // Also sync role and active status with Auth
    if (userData.supabase_user_id) {
       await supabaseAdmin.auth.admin.updateUserById(userData.supabase_user_id, {
          user_metadata: { role: userData.role, tenant_id: tenantId },
          ban_duration: userData.is_active ? 'none' : '876000h' // ban for 100 years if inactive
       });
    }

    res.json({ data: userData });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Erro ao processar a requisição' });
  }
});

// Admin Payment Gateways Endpoints
app.get("/api/v1/tenants/:tenantId/payment-gateways", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { data, error } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId);
      
    if (error) throw error;

    // Mask sensitive keys before returning to admin panel
    const maskedData = (data || []).map((gw: any) => {
      const maskedCreds = { ...gw.credentials };
      if (gw.gateway_name === "stripe" && maskedCreds.secretKey) {
        maskedCreds.secretKey = maskedCreds.secretKey.substring(0, 8) + "..." + maskedCreds.secretKey.slice(-4);
      }
      if (gw.gateway_name === "picpay" && maskedCreds.sellerToken) {
        maskedCreds.sellerToken = maskedCreds.sellerToken.substring(0, 8) + "..." + maskedCreds.sellerToken.slice(-4);
      }
      if (gw.gateway_name === "infinitepay" || gw.gateway_name === "mercado_pago") {
        if (maskedCreds.clientSecret) maskedCreds.clientSecret = maskedCreds.clientSecret.substring(0, 8) + "..." + maskedCreds.clientSecret.slice(-4);
        if (maskedCreds.accessToken) maskedCreds.accessToken = maskedCreds.accessToken.substring(0, 8) + "..." + maskedCreds.accessToken.slice(-4);
      }
      
      return { ...gw, credentials: maskedCreds };
    });

    res.json({ data: maskedData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/:tenantId/payment-gateways", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { gateway_name, is_active, credentials } = req.body;

    // Validate connection logic (Simulated for this implementation)
    // Note: In real production, we'd hit exactly the provider API to verify credentials here.
    if (req.query.test === "true") {
      // Simulate validation failure if secret is missing
      if (gateway_name === "stripe" && !credentials.secretKey) {
        return res.status(400).json({ error: "Invalid Stripe Secret Key" });
      }
      return res.json({ success: true, message: "Conexão validada com sucesso!" });
    }

    // Check if it exists to do an upsert
    const { data: existing } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("gateway_name", gateway_name)
      .single();

    let finalCredentials = { ...credentials };

    // If an existing record was found and a masked secret was submitted, keep the original string
    if (existing) {
       for (const key in credentials) {
           if (typeof credentials[key] === 'string' && credentials[key].includes("...")) {
               finalCredentials[key] = existing.credentials[key];
           }
       }
    }

    const payload = {
      tenant_id: tenantId,
      gateway_name,
      is_active,
      credentials: finalCredentials,
      updated_at: new Date().toISOString()
    };

    let result;
    if (existing) {
      result = await supabase
        .from("tenant_payment_gateways")
        .update(payload)
        .eq("id", existing.id);
    } else {
      result = await supabase
        .from("tenant_payment_gateways")
        .insert(payload);
    }

    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// TENANT SETTINGS & WELCOME MESSAGE ENDPOINTS
// ============================================================================
app.all(["/api/v1/tenants/:tenantId/settings", "/api/v1/tenants/settings", "/api/v1/agent/settings"], async (req, res) => {
  if (req.method !== "PATCH" && req.method !== "PUT" && req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawTenantId = req.params.tenantId || req.body?.tenantId || req.body?.storeId || req.query?.tenantId || req.headers["x-tenant-id"];
    
    if (!rawTenantId && req.method === "GET") {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }

    // Resolving target tenant by id or slug
    let targetTenant: any = null;
    if (rawTenantId) {
      const cleanId = String(rawTenantId).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
      if (isUuid) {
        const { data } = await supabaseAdmin.from("tenants").select("*").eq("id", cleanId).maybeSingle();
        targetTenant = data;
      }
      if (!targetTenant) {
        const cleanSlug = cleanId.replace(/^store_/, '');
        const { data } = await supabaseAdmin.from("tenants").select("*").eq("slug", cleanSlug).maybeSingle();
        targetTenant = data;
      }
    }

    if (!targetTenant) {
      // Fallback: get the first active tenant
      const { data } = await supabaseAdmin.from("tenants").select("*").limit(1).maybeSingle();
      targetTenant = data;
    }

    if (!targetTenant) {
      return res.status(404).json({ error: "Tenant não encontrado." });
    }

    if (req.method === "GET") {
      return res.json({
        success: true,
        data: sanitizeTenantErpCredentialsForClient(targetTenant),
      });
    }

    // Update settings payload
    const body = req.body || {};
    const updates: Record<string, any> = {};

    if (body.welcome_message_enabled !== undefined || body.welcomeMessageEnabled !== undefined) {
      updates.welcome_message_enabled = Boolean(body.welcome_message_enabled ?? body.welcomeMessageEnabled);
    }
    if (body.welcome_message_text !== undefined || body.welcomeMessageText !== undefined) {
      updates.welcome_message_text = String(body.welcome_message_text ?? body.welcomeMessageText ?? "");
    }
    if (body.welcome_message_format !== undefined || body.welcomeMessageFormat !== undefined || body.welcome_button_format !== undefined || body.welcomeButtonFormat !== undefined || body.button_type !== undefined) {
      updates.welcome_message_format = String(body.welcome_message_format ?? body.welcomeMessageFormat ?? body.welcome_button_format ?? body.welcomeButtonFormat ?? body.button_type ?? "button");
    }
    if (body.welcome_message_link !== undefined || body.welcomeMessageLink !== undefined) {
      updates.welcome_message_link = String(body.welcome_message_link ?? body.welcomeMessageLink ?? "");
    }
    if (body.is_ai_agent_enabled !== undefined || body.isAiAgentEnabled !== undefined) {
      updates.is_ai_agent_enabled = Boolean(body.is_ai_agent_enabled ?? body.isAiAgentEnabled);
    }
    if (body.ai_agent_config !== undefined || body.aiAgentConfig !== undefined) {
      updates.ai_agent_config = body.ai_agent_config ?? body.aiAgentConfig;
    }
    const hasInovafarmaCredUpdate =
      body.erp_base_url !== undefined ||
      body.erpBaseUrl !== undefined ||
      body.erp_url !== undefined ||
      body.erpUrl !== undefined ||
      body.erp_route_id !== undefined ||
      body.erpRouteId !== undefined ||
      body.erp_cnpj !== undefined ||
      body.erpCnpj !== undefined ||
      body.erp_login !== undefined ||
      body.erp_api_login !== undefined ||
      body.erpApiLogin !== undefined ||
      body.erp_password !== undefined ||
      body.erp_api_password !== undefined ||
      body.erpApiPassword !== undefined ||
      body.erp_api_key !== undefined ||
      body.erpApiKey !== undefined;

    if (hasInovafarmaCredUpdate) {
      const existingSmartBanners =
        (updates.smart_banners || targetTenant.smart_banners) &&
        typeof (updates.smart_banners || targetTenant.smart_banners) === "object"
          ? { ...(updates.smart_banners || targetTenant.smart_banners) }
          : {};
      const existingCreds =
        existingSmartBanners._erpCredentials && typeof existingSmartBanners._erpCredentials === "object"
          ? { ...existingSmartBanners._erpCredentials }
          : {};

      if (body.erp_base_url !== undefined || body.erpBaseUrl !== undefined || body.erp_url !== undefined || body.erpUrl !== undefined) {
        const cleanUrl = String(body.erp_base_url ?? body.erpBaseUrl ?? body.erp_url ?? body.erpUrl ?? "").trim();
        existingCreds.erp_base_url = cleanUrl;
        if (cleanUrl) updates.erp_url = cleanUrl;
      }
      if (body.erp_route_id !== undefined || body.erpRouteId !== undefined) {
        existingCreds.erp_route_id = String(body.erp_route_id ?? body.erpRouteId ?? "").trim();
      }
      if (body.erp_cnpj !== undefined || body.erpCnpj !== undefined) {
        existingCreds.erp_cnpj = sanitizeCnpj(body.erp_cnpj ?? body.erpCnpj ?? "");
      }
      if (body.erp_api_key !== undefined || body.erpApiKey !== undefined) {
        existingCreds.erp_api_key = String(body.erp_api_key ?? body.erpApiKey ?? "").trim();
      }
      if (body.erp_login !== undefined || body.erp_api_login !== undefined || body.erpApiLogin !== undefined) {
        const cleanLogin = String(body.erp_login ?? body.erp_api_login ?? body.erpApiLogin ?? "").trim();
        existingCreds.erp_login = cleanLogin;
        existingCreds.erp_api_login = cleanLogin;
      }
      if (body.erp_password !== undefined || body.erp_api_password !== undefined || body.erpApiPassword !== undefined) {
        const rawPassword = String(body.erp_password ?? body.erp_api_password ?? body.erpApiPassword ?? "").trim();
        if (rawPassword && !isMaskedErpPassword(rawPassword)) {
          existingCreds.erp_api_password_enc = encryptErpPassword(rawPassword, targetTenant.id);
          delete existingCreds.erp_api_password;
          // Invalida token em cache se senha foi alterada
          delete existingCreds.erp_access_token;
          delete existingCreds.erp_token_expiration;
        }
      }

      existingSmartBanners._erpCredentials = existingCreds;
      updates.smart_banners = existingSmartBanners;
    }

    console.log(`[TenantSettings] Atualizando configurações para tenant "${targetTenant.name}" (${targetTenant.id})`);

    const { data: updated, error } = await supabaseAdmin
      .from("tenants")
      .update(updates)
      .eq("id", targetTenant.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[TenantSettings] Erro ao atualizar tenant no Supabase:", error);
      throw error;
    }

    return res.json({
      success: true,
      message: "Configurações atualizadas com sucesso",
      data: sanitizeTenantErpCredentialsForClient(updated || { ...targetTenant, ...updates }),
    });
  } catch (err: any) {
    console.error("[TenantSettings] Exceção ao processar configurações:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Mercado Pago Backend Integration & Checkout Preferencing
app.post("/api/v1/store/:tenantId/mercadopago/preference", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { items, customer, discount, total } = req.body;

    // Fetch the tenant's payment gateways settings
    const { data: gateway, error: gwError } = await supabase
      .from("tenant_payment_gateways")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("gateway_name", "mercado_pago")
      .eq("is_active", true)
      .maybeSingle();

    if (gwError || !gateway) {
      return res.status(404).json({ error: "Integração do Mercado Pago não configurada ou inativa para este estabelecimento." });
    }

    const accessToken = gateway.credentials?.accessToken || gateway.credentials?.access_token;
    if (!accessToken) {
      return res.status(400).json({ error: "Token de acesso do Mercado Pago ausente." });
    }

    // Generate a secure, validated format fallback email based on customer WhatsApp
    const buyerPhone = customer?.phone || customer?.whatsapp || "00000000000";
    const cleanPhone = buyerPhone.replace(/\D/g, "");
    const fallbackEmail = `cliente.${cleanPhone || "00000000000"}@gmail.com`;

    const mpItems = [
      {
        id: "order_total",
        title: `Pedido na farmácia - ${tenantId.toUpperCase()}`,
        quantity: 1,
        unit_price: Number(total),
        currency_id: "BRL"
      }
    ];

    const preferencePayload = {
      items: mpItems,
      payer: {
        name: customer?.name || "Cliente FarmaFlow",
        email: fallbackEmail
      },
      back_urls: {
        success: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=success`,
        failure: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=failure`,
        pending: `${req.get("origin") || "https://farmaflow.com"}/store/${tenantId}?payment=pending`
      },
      auto_return: "all"
    };

    // Logging payload for auditing purposes
    console.log("Mercado Pago Preference Payload:", JSON.stringify(preferencePayload));

    const mpResponse = await fetch("https://api.mercadopago.com/v1/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify(preferencePayload)
    });

    const mpJson = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Mercado Pago Preference API error detail:", JSON.stringify(mpJson));
      return res.status(mpResponse.status).json({ error: mpJson.message || "Erro ao gerar preferência no Mercado Pago." });
    }

    return res.json({
      id: mpJson.id,
      init_point: mpJson.init_point,
      sandbox_init_point: mpJson.sandbox_init_point
    });
  } catch (err: any) {
    console.error("Error creating Mercado Pago Preference (Full Error):", err);
    if (err.response) {
      console.error("Error response details:", err.response.data);
    }
    return res.status(400).json({ error: "Erro ao gerar link de pagamento" });
  }
});

const ENDPOINT_PHARMA_SYNONYMS: Record<string, string[]> = {
  fralda: ["fralda", "fraldas", "fra", "fr"],
  fraldas: ["fralda", "fraldas", "fra", "fr"],
  fra: ["fralda", "fraldas", "fra", "fr"],
  fr: ["fralda", "fraldas", "fra", "fr"],
  absorvente: ["absorvente", "absorventes", "abs"],
  absorventes: ["absorvente", "absorventes", "abs"],
  abs: ["absorvente", "absorventes", "abs"],
  gotas: ["gotas", "gts", "gota", "sol", "solucao"],
  gts: ["gotas", "gts", "gota", "sol", "solucao"],
  sol: ["sol", "solucao", "gotas", "gts"],
  solucao: ["sol", "solucao", "gotas", "gts"],
  comprimido: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  comprimidos: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  comp: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  cp: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  cpl: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  cpr: ["comprimido", "comprimidos", "cp", "cpl", "cpr", "comp"],
  creme: ["creme", "cr"],
  cr: ["creme", "cr"],
  dent: ["dent", "dental", "cr dent", "gel dent"],
  dental: ["dent", "dental", "cr dent", "gel dent"],
  pomada: ["pomada", "pomadas", "pom"],
  pomadas: ["pomada", "pomadas", "pom"],
  pom: ["pomada", "pomadas", "pom"],
  xarope: ["xarope", "xaropes", "xpe"],
  xaropes: ["xarope", "xaropes", "xpe"],
  xpe: ["xarope", "xaropes", "xpe"],
  desodorante: ["desodorante", "desodorantes", "desod", "aero"],
  desodorantes: ["desodorante", "desodorantes", "desod", "aero"],
  desod: ["desodorante", "desodorantes", "desod", "aero"],
  aero: ["desodorante", "desodorantes", "desod", "aero"],
  sabonete: ["sabonete", "sabonetes", "sab"],
  sabonetes: ["sabonete", "sabonetes", "sab"],
  sab: ["sabonete", "sabonetes", "sab"],
  capsula: ["capsula", "cap"],
  capsulas: ["capsula", "cap"],
  cap: ["capsula", "cap"],
  miligrama: ["miligrama", "mg"],
  miligramas: ["miligrama", "mg"],
  mg: ["miligrama", "mg"],
  paracetamol: ["paracetamol", "tylenol"],
  tylenol: ["paracetamol", "tylenol"],
  dipirona: ["dipirona", "novalgina", "maxalgina", "dipimed"],
  novalgina: ["dipirona", "novalgina", "maxalgina"],
  ibuprofeno: ["ibuprofeno", "alivium", "advil"],
  alivium: ["ibuprofeno", "alivium"],
  dorflex: ["dorflex", "dorilax", "miosan"],
  shampoo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  sh: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xampu: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  shamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  shampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  xampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"]
};

function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getLevenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[a.length][b.length];
}

// Paginated Products Endpoint for Infinite Scroll & Reactive Search
app.get("/api/v1/store/:tenantId/products", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const category = req.query.category as string;
    const search = req.query.search as string;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // 1. Try to use the high-performance Postgres RPC search if available
    if (search && search.trim().length > 0) {
      const cleanSearch = normalizeText(search);
      const isDiaSeguinte = 
        cleanSearch.includes("pilula do dia seguinte") || 
        cleanSearch.includes("pilula dia seguinte") || 
        cleanSearch.includes("dia seguinte") ||
        cleanSearch.includes("anticoncepcional de emergencia") ||
        cleanSearch.includes("anticoncepcional do dia seguinte");

      const isEstomago = 
        cleanSearch.includes("estomago") || 
        cleanSearch.includes("estômago") || 
        cleanSearch.includes("gastrico") || 
        cleanSearch.includes("gástrico") || 
        cleanSearch.includes("protetor gastrico") || 
        cleanSearch.includes("protetor gástrico") || 
        cleanSearch.includes("digestao") || 
        cleanSearch.includes("digestão") || 
        cleanSearch.includes("azia") || 
        cleanSearch.includes("digestivo") || 
        cleanSearch.includes("digestivos") ||
        cleanSearch.includes("antiacido") ||
        cleanSearch.includes("antiácido");

      const searchTermToUse = isDiaSeguinte 
        ? "dia d | diad | dia-d | pozato | neodia | pilem | levonorgestrel | postinor | evenose | emergencia"
        : isEstomago
          ? "omeprazol | pantoprazol | esomeprazol | lansoprazol | rabeprazol | dexlansoprazol | peprazol | pantocal | gastrium | estomago | gastrico | digestivo | digestao | azia | antiacido | eno | estomazil | luftal | simeticona | ranitidina | antidin | pepto | domperidona | metoclopramida | plasil | digesan | gastro"
          : search;

      const detectedSize = extractProductSize(search);

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("search_products_v2", {
          p_tenant_id: tenantId,
          p_search_term: searchTermToUse,
          p_category: category || "Todos",
          p_limit: limit,
          p_offset: from
        });

        if (!rpcError && Array.isArray(rpcData)) {
          const validRpcData = rpcData.filter((p: any) =>
            Number(p.price) > 0 &&
            Number(p.stock ?? 1) > 0 &&
            (!detectedSize || productMatchesSize(p, detectedSize))
          );
          if (validRpcData.length > 0 && !detectedSize) {
            res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
            return res.json({
              data: validRpcData,
              total: validRpcData.length >= limit ? -1 : validRpcData.length + from,
              page,
              limit,
              source: "postgres_rpc"
            });
          }
          console.log(`[Search Fallback] RPC search_products_v2 retornou ${validRpcData.length} itens para "${searchTermToUse}" (detectedSize=${detectedSize || 'none'}). Acionando busca inteligente com abreviações de ERP e filtro estrito de tamanho...`);
        } else {
          console.warn("RPC search_products_v2 failed or not found, falling back to server intelligent search:", rpcError);
        }
      } catch (rpcExc) {
        console.warn("Exception calling search_products_v2, falling back:", rpcExc);
      }
    }

    // 2. Server-side intelligent search fallback
    let query = supabase
      .from("products")
      .select("id, tenant_id, internal_code, barcode, name, active_principle, drug_type, manufacturer, presentation, price, original_price, promotional_price, stock, category, grouping_slug, variant_attribute, image, is_featured, requires_prescription, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, video_uri, description, indications, usage, side_effects, contraindications, is_ai_enriched", { count: "exact" })
      .eq("tenant_id", tenantId)
      .gt("price", 0);

    if (category && category !== "Todos") {
      query = query.ilike("category", `%${category}%`);
    }

    const cleanSearchText = search ? normalizeText(search) : "";
    const detectedSizeFallback = search ? extractProductSize(search) : null;
    const SIZE_STOP_TOKENS = new Set([
      "rn", "pp", "xp", "p", "m", "g", "gg", "xg", "eg", "xxg", "exg", "xxxg", "tamanho", "tam", "t"
    ]);

    const isDiaSeguinteFallback = 
      cleanSearchText.includes("pilula do dia seguinte") || 
      cleanSearchText.includes("pilula dia seguinte") || 
      cleanSearchText.includes("dia seguinte") ||
      cleanSearchText.includes("anticoncepcional de emergencia") ||
      cleanSearchText.includes("anticoncepcional do dia seguinte");

    const isEstomagoFallback = 
      cleanSearchText.includes("estomago") || 
      cleanSearchText.includes("estômago") || 
      cleanSearchText.includes("gastrico") || 
      cleanSearchText.includes("gástrico") || 
      cleanSearchText.includes("protetor gastrico") || 
      cleanSearchText.includes("protetor gástrico") || 
      cleanSearchText.includes("digestao") || 
      cleanSearchText.includes("digestão") || 
      cleanSearchText.includes("azia") || 
      cleanSearchText.includes("digestivo") || 
      cleanSearchText.includes("digestivos") ||
      cleanSearchText.includes("antiacido") ||
      cleanSearchText.includes("antiácido");

    if (search && search.trim().length > 0) {
      if (isDiaSeguinteFallback) {
        const emergencyTokens = ["dia", "d", "diad", "pozato", "neodia", "pilem", "levonorgestrel", "postinor", "evenose", "emergencia"];
        const tsQueryFormated = emergencyTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      } else if (isEstomagoFallback) {
        const gastricoTokens = ["omeprazol", "pantoprazol", "esomeprazol", "lansoprazol", "rabeprazol", "dexlansoprazol", "peprazol", "pantocal", "gastrium", "estomago", "gastrico", "digestivo", "digestao", "azia", "antiacido", "eno", "estomazil", "luftal", "simeticona", "ranitidina", "antidin", "pepto", "domperidona", "metoclopramida", "plasil", "digesan", "gastro"];
        const tsQueryFormated = gastricoTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      } else {
        // Remove tokens de 1 letra e indicadores de tamanho para evitar que 'g' dê match em qualquer palavra com G
        let searchTokens = cleanSearchText
          .split(/\s+/)
          .filter(t => t.length >= 2 && (!detectedSizeFallback || !SIZE_STOP_TOKENS.has(t)));

        if (searchTokens.length === 0 && detectedSizeFallback) {
          searchTokens = ["fralda"];
        }

        let expandedTokens = [...searchTokens];
        searchTokens.forEach(token => {
          const syns = ENDPOINT_PHARMA_SYNONYMS[token];
          if (syns) {
            expandedTokens = [...expandedTokens, ...syns];
          }
        });
        expandedTokens = Array.from(new Set(expandedTokens)).filter(t => t.length >= 2);

        const ilikeClauses = expandedTokens
          .slice(0, 8)
          .map(tok => `name.ilike.%${tok}%,category.ilike.%${tok}%,active_principle.ilike.%${tok}%`)
          .join(",");

        if (ilikeClauses) {
          query = query.or(ilikeClauses);
        }
      }
    }

    const fetchRangeEnd = detectedSizeFallback ? Math.max(to, 200) : to;
    const { data, count, error } = await query.range(from, fetchRangeEnd);
    if (error) throw error;

    let finalData = data || [];

    if (search && search.trim().length > 0) {
      // Filtro rigoroso de tamanho exato quando o cliente especificou tamanho (ex: G, M, P, GG, XG, XXG, RN)
      if (detectedSizeFallback) {
        finalData = finalData.filter((prod: any) => productMatchesSize(prod, detectedSizeFallback));
      }

      const cleanSearch = normalizeText(search);
      const searchTokens = cleanSearch
        .split(/\s+/)
        .filter(t => t.length >= 2 && (!detectedSizeFallback || !SIZE_STOP_TOKENS.has(t)));

      let expandedTokens = [...searchTokens];
      searchTokens.forEach(token => {
        const syns = ENDPOINT_PHARMA_SYNONYMS[token];
        if (syns) {
          expandedTokens = [...expandedTokens, ...syns];
        }
      });
      expandedTokens = Array.from(new Set(expandedTokens)).filter(t => t.length >= 2);

      const scoredProducts = finalData.map((prod: any) => {
        const name = normalizeText(prod.name);
        const cat = normalizeText(prod.category);
        const act = normalizeText(prod.active_principle);
        const desc = normalizeText(prod.description);

        let score = 0;

        if (isDiaSeguinteFallback) {
          const isEmergency = 
            name.includes("dia d") ||
            name.includes("diad") ||
            name.includes("dia-d") ||
            name.includes("pozato") ||
            name.includes("neodia") ||
            name.includes("pilem") ||
            name.includes("postinor") ||
            name.includes("evenose") ||
            name.includes("emergencia") ||
            cat.includes("emergencia") ||
            (act.includes("levonorgestrel") && !act.includes("etinilestradiol"));
          
          if (isEmergency) score += 1000;
        } else if (isEstomagoFallback) {
          const isGastrico = 
            name.includes("omeprazol") ||
            name.includes("pantoprazol") ||
            name.includes("esomeprazol") ||
            name.includes("lansoprazol") ||
            name.includes("rabeprazol") ||
            name.includes("dexlansoprazol") ||
            name.includes("peprazol") ||
            name.includes("pantocal") ||
            name.includes("gastrium") ||
            name.includes("estomago") ||
            name.includes("gastrico") ||
            name.includes("digestivo") ||
            name.includes("digestao") ||
            name.includes("azia") ||
            name.includes("antiacido") ||
            name.includes("eno") ||
            name.includes("estomazil") ||
            name.includes("luftal") ||
            name.includes("simeticona") ||
            name.includes("ranitidina") ||
            name.includes("antidin") ||
            name.includes("pepto") ||
            name.includes("domperidona") ||
            name.includes("metoclopramida") ||
            name.includes("plasil") ||
            name.includes("digesan") ||
            cat.includes("gastro") ||
            cat.includes("antiacido") ||
            cat.includes("antiulceroso") ||
            cat.includes("ulcer") ||
            desc.includes("estomago") ||
            desc.includes("gastrico") ||
            desc.includes("azia") ||
            desc.includes("ulcer") ||
            act.includes("omeprazol") ||
            act.includes("pantoprazol") ||
            act.includes("esomeprazol") ||
            act.includes("lansoprazol") ||
            act.includes("rabeprazol") ||
            act.includes("dexlansoprazol") ||
            act.includes("simeticona") ||
            act.includes("ranitidina") ||
            act.includes("domperidona") ||
            act.includes("metoclopramida");

          if (isGastrico) score += 1000;
        } else {
          if (name === cleanSearch) {
            score += 1000;
          } else if (name.startsWith(cleanSearch)) {
            score += 800;
          } else if (name.includes(cleanSearch)) {
            score += 600;
          }

          searchTokens.forEach(token => {
            if (token.length < 2) return;
            if (name.includes(token)) score += 300;
            if (cat.includes(token)) score += 200;
            if (act.includes(token)) score += 200;
            if (desc.includes(token)) {
              score += 10;
            }
          });

          expandedTokens.forEach(token => {
            if (token.length < 2) return;
            if (!searchTokens.includes(token)) {
              if (name.includes(token)) score += 150;
              if (cat.includes(token)) score += 100;
              if (act.includes(token)) score += 100;
              if (desc.includes(token)) score += 5;
            }
          });

          if (detectedSizeFallback && productMatchesSize(prod, detectedSizeFallback)) {
            score += 500;
          }
        }

        const nameWords = name.split(/\s+/);
        searchTokens.forEach(token => {
          if (token.length > 3) {
            nameWords.forEach(word => {
              if (word.length > 3) {
                const dist = getLevenshteinDistance(token, word);
                if (dist <= 1) {
                  score += 100;
                }
              }
            });
          }
        });

        const hasMainMatch = searchTokens.some(tok => name.includes(tok) || cat.includes(tok) || act.includes(tok)) ||
                             expandedTokens.some(tok => name.includes(tok) || cat.includes(tok) || act.includes(tok));
        
        if (!hasMainMatch && desc.length > 0) {
          score = score * 0.05;
        }

        if (prod.is_featured) {
          score += 50;
        }

        return { ...prod, _score: score };
      });

      scoredProducts.sort((a, b) => b._score - a._score || Number(a.price) - Number(b.price));
      finalData = scoredProducts.slice(0, limit).map(p => {
        const { _score, ...rest } = p;
        return rest;
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    res.json({ data: finalData, total: count || 0, page, limit });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/matrix/bulk-featured-products", async (req, res) => {
  try {
    const { productIds, targetTenantIds, mode } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "Parâmetro productIds é obrigatório e deve ser uma lista não vazia." });
    }
    if (!targetTenantIds || !Array.isArray(targetTenantIds) || targetTenantIds.length === 0) {
      return res.status(400).json({ error: "Parâmetro targetTenantIds é obrigatório e deve ser uma lista não vazia." });
    }

    const isReplaceMode = mode === 'replace';

    // If replace mode, we first reset is_featured to false for all products in the selected target tenants
    if (isReplaceMode) {
      const { error: resetError } = await supabase
        .from("products")
        .update({ is_featured: false })
        .in("tenant_id", targetTenantIds)
        .eq("is_featured", true);

      if (resetError) throw resetError;
    }

    // 1. Fetch matrix products to get their barcodes (EAN)
    const { data: matrixProducts, error: matrixError } = await supabase
      .from("products")
      .select("barcode")
      .in("id", productIds);

    if (matrixError) throw matrixError;
    if (!matrixProducts || matrixProducts.length === 0) {
      return res.status(404).json({ error: "Nenhum produto correspondente encontrado na Matriz." });
    }

    // Gather all barcodes to match on - Nunca usar internal_code entre farmácias
    const barcodes = matrixProducts.map(p => p.barcode ? String(p.barcode).trim() : null).filter(Boolean) as string[];

    if (barcodes.length === 0) {
      return res.status(400).json({ error: "Os produtos selecionados na Matriz não possuem código de barras (EAN) para correspondência." });
    }

    // 2. Query target products strictly by barcode (EAN)
    const orClauses: string[] = [];
    barcodes.forEach(b => {
      orClauses.push(`barcode.eq.${b}`);
    });

    let query = supabase
      .from("products")
      .select("id, tenant_id, barcode, internal_code")
      .in("tenant_id", targetTenantIds);

    if (orClauses.length > 0) {
      query = query.or(orClauses.join(","));
    }

    const { data: targetProducts, error: targetError } = await query;
    if (targetError) throw targetError;

    if (!targetProducts || targetProducts.length === 0) {
      // Save logs even when no matched products to record that the showcase was reset (if in replace mode)
      try {
        await supabase.from("integration_logs").insert({
          tenant_id: targetTenantIds[0],
          endpoint: "bulk_featured_products",
          payload: {
            productIds,
            targetTenantIds,
            mode: mode || "append",
            updatedProductIds: [],
            timestamp: new Date().toISOString()
          },
          status: "SUCCESS"
        });
      } catch (logErr) {
        console.error("Erro ao gravar logs de auditoria em lote:", logErr);
      }

      return res.status(200).json({
        success: true,
        message: isReplaceMode
          ? "Os destaques anteriores foram removidos com sucesso, mas nenhum produto correspondente foi encontrado nas filiais selecionadas para destacar."
          : "Nenhum produto correspondente foi encontrado nas filiais selecionadas para destacar.",
        updatedCount: 0
      });
    }

    const targetProductIdsToUpdate = targetProducts.map(p => p.id);

    // Update is_featured to true inside a single atomic operation
    const { error: updateError } = await supabase
      .from("products")
      .update({ is_featured: true })
      .in("id", targetProductIdsToUpdate);

    if (updateError) throw updateError;

    // Save logs to integration_logs for audit
    try {
      await supabase.from("integration_logs").insert({
        tenant_id: targetTenantIds[0], // associate with first target tenant
        endpoint: "bulk_featured_products",
        payload: {
          productIds,
          targetTenantIds,
          mode: mode || "append",
          updatedProductIds: targetProductIdsToUpdate,
          timestamp: new Date().toISOString()
        },
        status: "SUCCESS"
      });
    } catch (logErr) {
      console.error("Erro ao gravar logs de auditoria em lote:", logErr);
    }

    res.json({
      success: true,
      message: isReplaceMode
        ? `Vitrine substituída com sucesso! ${targetProductIdsToUpdate.length} novos produtos foram definidos como destaque nas filiais selecionadas.`
        : `${targetProductIdsToUpdate.length} produtos foram adicionados como destaque nas filiais selecionadas com sucesso.`,
      updatedCount: targetProductIdsToUpdate.length
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/matrix/bulk-featured-products:", err);
    res.status(500).json({ error: err.message });
  }
});

// Cacheable Products Endpoint for Vercel Edge Cache (ISR Pattern)

app.put("/api/v1/tenants/:tenantId/products/bulk", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { products } = req.body;
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: "Invalid products array" });
    }

    if (products.length === 0) {
      return res.json({ success: true, totalReceived: 0, savedCount: 0, failedCount: 0, failedDetails: [] });
    }
    
    // 1. Sanitize, validate and deduplicate incoming batch
    const sanitizedProducts: any[] = [];
    const seenBarcodesInBatch = new Map<string, number>();
    const seenCodesInBatch = new Map<string, number>();
    const duplicateBarcodesMerged: { barcode: string; name: string }[] = [];

    for (const p of products) {
      if (!p) continue;

      const rawPromo = p.promotional_price !== undefined && p.promotional_price !== null
        ? p.promotional_price
        : (p.promotionalPrice !== undefined && p.promotionalPrice !== null ? p.promotionalPrice : p.preco_promocional);
      const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
      const validPromo = !isNaN(numPromo) && numPromo > 0 ? numPromo : null;

      const rawSaleSource =
        p.price ??
        p.preco_venda ??
        p.precoVenda ??
        p.PRECO_VENDA ??
        p.preco ??
        p.salePrice ??
        p.valor_venda;
      const rawPrice = rawSaleSource !== undefined && rawSaleSource !== null && rawSaleSource !== '' ? Number(rawSaleSource) : 0;
      let validPrice = !isNaN(rawPrice) && rawPrice > 0 ? rawPrice : 0;

      let rawOrigSource =
        p.original_price ??
        p.originalPrice ??
        p.preco_original ??
        p.precoOriginal ??
        p.PRECO_ORIGINAL ??
        p.Vl_PMC ??
        p.vl_pmc ??
        p.VL_PMC ??
        p['Vl. PMC'] ??
        p.VlPMC ??
        p.Valor_PMC ??
        p.valor_pmc ??
        p.Vlr_PMC ??
        p.vlr_pmc ??
        p.Preco_PMC ??
        p.preco_pmc ??
        p.PRECO_PMC ??
        p.pmc ??
        p.PMC ??
        p.Preco_Maximo ??
        p.preco_maximo ??
        p.Vl_Tabela ??
        p.preco_tabela ??
        p.valor_original;

      if (rawOrigSource === undefined || rawOrigSource === null || rawOrigSource === '' || Number(rawOrigSource) <= 0) {
        for (const k of Object.keys(p)) {
          if (k.toLowerCase().includes('pmc')) {
            const candidateVal = parseInovafarmaNumber(p[k], 0);
            if (candidateVal > 0) {
              rawOrigSource = candidateVal;
              break;
            }
          }
        }
      }

      const rawOrigPrice = rawOrigSource !== undefined && rawOrigSource !== null && rawOrigSource !== ''
        ? parseInovafarmaNumber(rawOrigSource, 0)
        : 0;
      const validOrigPrice = !isNaN(rawOrigPrice) && rawOrigPrice > 0 ? rawOrigPrice : 0;

      // Regra de Fallback Inteligente de Preço:
      // Se preco_venda (price) for nulo, indefinido ou <= 0, assume automaticamente preco_original (PMC) ou promocional
      if (validPrice <= 0 && validOrigPrice > 0) {
        validPrice = validOrigPrice;
      } else if (validPrice <= 0 && validPromo !== null && validPromo > 0) {
        validPrice = validPromo;
      }

      // Normaliza estoque (se vier negativo, converte para 0) e verifica status ativo/inativo
      const rawStockVal =
        p.stock ??
        p.estoque ??
        p.Estoque_Atual ??
        p.estoque_atual ??
        p.Qtd_Estoque ??
        p.qtd_estoque ??
        p.saldo ??
        p.Saldo_Estoque ??
        p.quantidade;
      const rawStock = rawStockVal !== undefined && rawStockVal !== null && rawStockVal !== '' ? Number(rawStockVal) : 0;
      const isExplicitlyInactive =
        p.active === false ||
        p.ativo === false ||
        p.ativo === 0 ||
        ['0', 'N', 'NAO', 'NÃO', 'FALSE', 'I', 'INATIVO', 'BLOQUEADO', 'CANCELADO', 'EXCLUIDO'].includes(
          String(p.active ?? p.ativo ?? p.Ativo ?? p.situacao ?? p.Situacao ?? p.status ?? '').trim().toUpperCase()
        ) ||
        p.bloqueado === true ||
        p.bloqueado === 1 ||
        p.inativo === true ||
        p.inativo === 1 ||
        ['1', 'S', 'SIM', 'TRUE'].includes(String(p.bloqueado ?? p.inativo ?? '').trim().toUpperCase());

      const validStock = isExplicitlyInactive ? 0 : (!isNaN(rawStock) && rawStock > 0 ? Math.floor(rawStock) : 0);

      let cleanBarcode: string | null = null;
      const rawBarcodeInput = p.barcode ?? p.ean ?? p.codigo_barras ?? p.cod_barras;
      if (rawBarcodeInput !== undefined && rawBarcodeInput !== null && String(rawBarcodeInput).trim() !== '') {
        let rawBc = String(rawBarcodeInput).trim().replace(/^=?"|"$|^'/g, '').trim();
        if (/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(rawBc)) {
          const parsedNum = Number(rawBc.replace(',', '.'));
          if (Number.isFinite(parsedNum) && parsedNum > 0) {
            rawBc = Math.round(parsedNum).toFixed(0);
          }
        } else if (/^\d+[.,]0+$/.test(rawBc)) {
          rawBc = rawBc.split(/[.,]/)[0];
        }
        const digitsOnly = rawBc.replace(/\D/g, '');
        cleanBarcode = digitsOnly || rawBc || null;
      }
      const codeCandidates = [
        p.internal_code,
        p.internalCode,
        p.codigo_interno,
        p.cod_item,
        p.Cod_Item,
        p.COD_ITEM,
        p.codigo_item,
        p.Codigo_Item,
        p.cod_produto,
        p.Cod_Produto,
        p.codigo_produto,
        p.cod_prod,
        p.cd_produto,
        p.id_item,
        p.id_produto,
        p.codigo,
        p.código,
        p.cod,
        p.sku,
        p.referencia,
        p.ref
      ]
        .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
        .map(v => String(v).trim());

      const distinctCode = codeCandidates.find(c => !cleanBarcode || c !== cleanBarcode);
      const cleanCode = distinctCode || codeCandidates[0] || null;

      const rawNameInput = p.name ?? p.nome ?? p.descricao_produto ?? p.descricao;
      const item: any = {
        ...p,
        id: p.id || Math.random().toString(36).substr(2, 9),
        tenant_id: tenantId,
        tenantid: tenantId,
        name: rawNameInput ? String(rawNameInput).trim() : 'Produto sem nome',
        barcode: cleanBarcode,
        internal_code: cleanCode,
        price: validPrice,
        original_price: validOrigPrice,
        promotional_price: validPromo,
        stock: validStock,
        _isExplicitlyInactive: isExplicitlyInactive,
        category: p.category ? String(p.category).trim() : 'Geral',
        manufacturer: p.manufacturer ? String(p.manufacturer).trim() : 'Outros',
        active_principle: p.active_principle ?? p.activePrinciple ?? '',
        drug_type: p.drug_type ?? p.drugType ?? '',
        presentation: p.presentation ? String(p.presentation).trim() : '',
        description: p.description ? String(p.description).trim() : '',
        indications: p.indications ? String(p.indications).trim() : '',
        usage: p.usage ? String(p.usage).trim() : '',
        side_effects: p.side_effects ?? p.sideEffects ?? '',
        contraindications: p.contraindications ? String(p.contraindications).trim() : '',
        image: p.image || null,
        is_featured: Boolean(p.is_featured ?? p.isFeatured),
        requires_prescription: Boolean(p.requires_prescription ?? p.requiresPrescription),
        promotion_type: p.promotion_type ?? p.promotionType ?? 'NONE',
        buy_x: Number(p.buy_x ?? p.buyX) || 0,
        pay_y: Number(p.pay_y ?? p.payY) || 0,
        discount_qty_threshold: Number(p.discount_qty_threshold ?? p.discountQtyThreshold) || 0,
        discount_qty_percentage: Number(p.discount_qty_percentage ?? p.discountQtyPercentage) || 0,
        video_uri: p.video_uri ?? p.videoUri ?? null,
        is_ai_enriched: Boolean(p.is_ai_enriched ?? p.isAiEnriched)
      };

      // Unifica produtos com mesmo código de barras (EAN) no mesmo lote (mantém a linha mais recente)
      let mergedIdx: number | undefined = undefined;
      if (cleanBarcode && seenBarcodesInBatch.has(cleanBarcode)) {
        mergedIdx = seenBarcodesInBatch.get(cleanBarcode)!;
      }

      if (mergedIdx !== undefined) {
        sanitizedProducts[mergedIdx] = { ...sanitizedProducts[mergedIdx], ...item };
        duplicateBarcodesMerged.push({ barcode: cleanBarcode || '', name: item.name });
        continue;
      }

      const newIdx = sanitizedProducts.length;
      if (cleanBarcode) seenBarcodesInBatch.set(cleanBarcode, newIdx);

      sanitizedProducts.push(item);
    }

    // 2. Busca por EAN (barcode), código interno (internal_code) e ID no banco de dados da farmácia
    const barcodesToLookup = sanitizedProducts
      .map(p => p.barcode)
      .filter((b): b is string => Boolean(b && b.length > 0));

    const internalCodesToLookup = sanitizedProducts
      .map(p => p.internal_code)
      .filter((c): c is string => Boolean(c && c.length > 0));

    const idsToLookup = sanitizedProducts
      .map(p => p.id)
      .filter((id): id is string => Boolean(id && id.length > 0));

    const dbExistingByBarcode = new Map<string, { id: string; barcode: string | null; internal_code: string | null; name: string; price?: number | null; original_price?: number | null }>();
    const dbExistingByInternalCode = new Map<string, { id: string; barcode: string | null; internal_code: string | null; name: string; price?: number | null; original_price?: number | null }>();
    const dbExistingById = new Map<string, { id: string; barcode: string | null; internal_code: string | null; name: string; price?: number | null; original_price?: number | null }>();

    const LOOKUP_CHUNK = 500;

    if (barcodesToLookup.length > 0) {
      for (let i = 0; i < barcodesToLookup.length; i += LOOKUP_CHUNK) {
        const barcodeChunk = barcodesToLookup.slice(i, i + LOOKUP_CHUNK);
        const { data: dbMatches } = await supabaseAdmin
          .from("products")
          .select("id, barcode, internal_code, name, price, original_price")
          .eq("tenant_id", tenantId)
          .in("barcode", barcodeChunk);

        if (dbMatches) {
          dbMatches.forEach(row => {
            if (row.barcode) dbExistingByBarcode.set(String(row.barcode).trim(), row);
            if (row.internal_code) dbExistingByInternalCode.set(String(row.internal_code).trim(), row);
            dbExistingById.set(row.id, row);
          });
        }
      }
    }

    if (internalCodesToLookup.length > 0) {
      for (let i = 0; i < internalCodesToLookup.length; i += LOOKUP_CHUNK) {
        const codeChunk = internalCodesToLookup.slice(i, i + LOOKUP_CHUNK);
        const { data: dbMatches } = await supabaseAdmin
          .from("products")
          .select("id, barcode, internal_code, name, price, original_price")
          .eq("tenant_id", tenantId)
          .in("internal_code", codeChunk);

        if (dbMatches) {
          dbMatches.forEach(row => {
            if (row.barcode) dbExistingByBarcode.set(String(row.barcode).trim(), row);
            if (row.internal_code) dbExistingByInternalCode.set(String(row.internal_code).trim(), row);
            dbExistingById.set(row.id, row);
          });
        }
      }
    }

    if (idsToLookup.length > 0) {
      for (let i = 0; i < idsToLookup.length; i += LOOKUP_CHUNK) {
        const idChunk = idsToLookup.slice(i, i + LOOKUP_CHUNK);
        const { data: dbMatches } = await supabaseAdmin
          .from("products")
          .select("id, barcode, internal_code, name, price, original_price")
          .eq("tenant_id", tenantId)
          .in("id", idChunk);

        if (dbMatches) {
          dbMatches.forEach(row => {
            if (row.barcode) dbExistingByBarcode.set(String(row.barcode).trim(), row);
            if (row.internal_code) dbExistingByInternalCode.set(String(row.internal_code).trim(), row);
            dbExistingById.set(row.id, row);
          });
        }
      }
    }

    // 3. Classifica produtos entre UPDATE (já existentes por EAN, internal_code ou ID) e INSERT (genuinamente novos)
    const productsToUpdate: any[] = [];
    const productsToInsert: any[] = [];
    let savedCount = 0;
    let failedCount = 0;
    let ignoredZeroStockNewCount = 0;
    const failedDetails: any[] = [];

    for (const p of sanitizedProducts) {
      const isItemInactive = Boolean(p._isExplicitlyInactive);
      delete p._isExplicitlyInactive;
      delete p.active;
      delete p.ativo;
      delete p.Ativo;
      delete p.situacao;
      delete p.Situacao;
      delete p.status;
      delete p.bloqueado;
      delete p.inativo;
      delete p.estoque;
      delete p.Estoque_Atual;
      delete p.estoque_atual;
      delete p.Qtd_Estoque;
      delete p.qtd_estoque;
      delete p.saldo;
      delete p.Saldo_Estoque;
      delete p.quantidade;
      // Remove campos de alias temporários para não enviar colunas inexistentes ao Supabase
      delete p.preco_venda;
      delete p.precoVenda;
      delete p.PRECO_VENDA;
      delete p.preco;
      delete p.salePrice;
      delete p.valor_venda;
      delete p.preco_original;
      delete p.precoOriginal;
      delete p.PRECO_ORIGINAL;
      delete p.originalPrice;
      delete p.pmc;
      delete p.PMC;
      delete p.preco_pmc;
      delete p.PRECO_PMC;
      delete p.preco_tabela;
      delete p.valor_original;
      delete p.promotionalPrice;
      delete p.preco_promocional;
      delete p.internalCode;
      delete p.activePrinciple;
      delete p.drugType;
      delete p.sideEffects;
      delete p.isFeatured;
      delete p.requiresPrescription;
      delete p.promotionType;
      delete p.buyX;
      delete p.payY;
      delete p.discountQtyThreshold;
      delete p.discountQtyPercentage;
      delete p.videoUri;
      delete p.isAiEnriched;
      delete p.groupingSlug;
      delete p.variantAttribute;

      let existingMatch: { id: string; barcode: string | null; internal_code: string | null; name: string; price?: number | null; original_price?: number | null } | undefined = undefined;

      // Correspondência por barcode (EAN), internal_code ou ID existente
      if (p.barcode && dbExistingByBarcode.has(p.barcode)) {
        existingMatch = dbExistingByBarcode.get(p.barcode);
      } else if (p.internal_code && dbExistingByInternalCode.has(p.internal_code)) {
        existingMatch = dbExistingByInternalCode.get(p.internal_code);
      } else if (p.id && dbExistingById.has(p.id)) {
        existingMatch = dbExistingById.get(p.id);
      }

      if (existingMatch) {
        // Produto JÁ EXISTE na farmácia: faz UPDATE normalmente (permitindo que stock vá para 0 caso tenha esgotado)
        p.id = existingMatch.id;
        if (Number(p.price) <= 0) {
          const existingValidPrice = Number(existingMatch.price) > 0
            ? Number(existingMatch.price)
            : (Number(existingMatch.original_price) > 0 ? Number(existingMatch.original_price) : 0);
          if (existingValidPrice > 0) {
            p.price = existingValidPrice;
          }
        }
        if (Number(p.price) <= 0 && Number(p.original_price) <= 0) {
          failedCount++;
          failedDetails.push({
            name: p.name,
            barcode: p.barcode,
            code: p.internal_code,
            reason: "Preço inválido: informe preco_venda ou preco_original (PMC) maior que zero."
          });
          continue;
        }
        productsToUpdate.push(p);
      } else {
        // Produto NÃO EXISTE no banco (seria um INSERT novo):
        // Regra de proteção: NUNCA inserir produto novo se estiver com estoque <= 0 ou inativo
        if (Number(p.stock) <= 0 || isItemInactive) {
          ignoredZeroStockNewCount++;
          continue;
        }
        if (Number(p.price) <= 0 && Number(p.original_price) <= 0) {
          failedCount++;
          failedDetails.push({
            name: p.name,
            barcode: p.barcode,
            code: p.internal_code,
            reason: "Preço inválido: informe preco_venda ou preco_original (PMC) maior que zero."
          });
          continue;
        }
        productsToInsert.push(p);
      }
    }

    if (ignoredZeroStockNewCount > 0) {
      console.log(`[Bulk Products] Tenant ${tenantId}: ${ignoredZeroStockNewCount} produtos novos ignorados por estarem com estoque <= 0 ou inativos.`);
    }

    // 4. Execução do Salvamento com Tratamento Silencioso de Conflitos (23505)
    const CHUNK_SIZE = 100;

    const is23505Error = (err: any) => {
      if (!err) return false;
      return err.code === '23505' ||
             String(err.message || '').includes('23505') ||
             String(err.message || '').includes('unique constraint') ||
             String(err.details || '').includes('already exists');
    };

    // 4A. Atualização de Produtos Existentes (UPDATE via Upsert no ID existente)
    for (let i = 0; i < productsToUpdate.length; i += CHUNK_SIZE) {
      const chunk = productsToUpdate.slice(i, i + CHUNK_SIZE);
      const cleanChunk = chunk.map(({ tenantid, ...rest }) => rest);
      
      const { error } = await supabaseAdmin.from("products").upsert(cleanChunk, { onConflict: 'id' });
      if (!error) {
        savedCount += cleanChunk.length;
      } else {
        // Fallback item a item para produtos existentes
        for (const item of cleanChunk) {
          const { id, tenant_id, ...updatePayload } = item;
          const { error: itemErr } = await supabaseAdmin
            .from("products")
            .update(updatePayload)
            .eq("id", id)
            .eq("tenant_id", tenantId);

          if (!itemErr) {
            savedCount++;
            continue;
          }

          if (is23505Error(itemErr)) {
            // Conflito de restrição de chave única (ex: internal_code colidiu no banco):
            // Atualiza silenciosamente os dados mantendo o registro sem alterar os campos que colidiram
            const safeUpdatePayload = { ...updatePayload };
            delete safeUpdatePayload.internal_code;
            delete safeUpdatePayload.barcode;

            const { error: safeErr } = await supabaseAdmin
              .from("products")
              .update(safeUpdatePayload)
              .eq("id", id)
              .eq("tenant_id", tenantId);

            if (!safeErr) {
              savedCount++;
              continue;
            }
          }

          failedCount++;
          failedDetails.push({
            name: item.name,
            barcode: item.barcode,
            code: item.internal_code,
            reason: itemErr.message || "Erro ao atualizar produto"
          });
        }
      }
    }

    // 4B. Inserção de Novos Produtos com correspondência estrita por EAN e tratamento de 23505
    for (let i = 0; i < productsToInsert.length; i += CHUNK_SIZE) {
      const chunk = productsToInsert.slice(i, i + CHUNK_SIZE);
      const cleanChunk = chunk.map(({ tenantid, ...rest }) => rest);

      const { error } = await supabaseAdmin.from("products").insert(cleanChunk);
      if (!error) {
        savedCount += cleanChunk.length;
      } else {
        // Fallback item por item com verificação estritamente por EAN
        for (const item of cleanChunk) {
          const { error: itemErr } = await supabaseAdmin.from("products").insert([item]);
          if (!itemErr) {
            savedCount++;
            continue;
          }

          if (is23505Error(itemErr)) {
            try {
              // 1. Se o produto tem EAN e ele já existe no banco, atualiza estritamente este produto pelo EAN
              if (item.barcode) {
                const { data: conflictRows } = await supabaseAdmin
                  .from("products")
                  .select("id")
                  .eq("tenant_id", tenantId)
                  .eq("barcode", item.barcode)
                  .limit(1);

                if (conflictRows && conflictRows.length > 0) {
                  const existingTargetId = conflictRows[0].id;
                  const { id, tenant_id, ...updatePayload } = item;
                  const { error: updErr } = await supabaseAdmin
                    .from("products")
                    .update(updatePayload)
                    .eq("id", existingTargetId)
                    .eq("tenant_id", tenantId);

                  if (!updErr) {
                    savedCount++;
                    continue;
                  }
                }
              }

              // 2. Se o conflito 23505 decorre de internal_code duplicado de outro produto com EAN diferente:
              // NUNCA sobrescrevemos outro produto! Liberamos o internal_code e inserimos o produto novo
              const safeNewItem = { ...item, internal_code: null };
              const { error: insRetryErr } = await supabaseAdmin.from("products").insert([safeNewItem]);
              if (!insRetryErr) {
                savedCount++;
                continue;
              }
            } catch {
              // Tratado silenciosamente
            }
          }

          failedCount++;
          failedDetails.push({
            name: item.name,
            barcode: item.barcode,
            code: item.internal_code,
            reason: itemErr.message || "Erro ao persistir produto"
          });
        }
      }
    }

    res.json({
      success: true,
      totalReceived: products.length,
      savedCount,
      failedCount,
      duplicatesMergedCount: duplicateBarcodesMerged.length,
      failedDetails
    });
  } catch (error: any) {
    console.error("Bulk upsert exception:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get(["/api/v1/tenants/:tenantId/products", "/api/products", "/api/store/:slug/products"], async (req, res) => {
  try {
    let tenantId = req.params.tenantId || (req.query.tenantId as string);
    const slug = req.params.slug || (req.query.slug as string);
    if (!tenantId && slug) {
      const { data: t } = await supabase.from("tenants").select("id").or(`slug.eq.${slug},id.eq.${slug}`).maybeSingle();
      if (t) tenantId = t.id;
    }
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId ou slug é obrigatório" });
    }

    const isAdmin = req.query.admin === "true" || req.query.include_zero_price === "true" || req.headers["x-admin-request"] === "true";

    let allData: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      let q = supabase
        .from("products")
        .select("id, tenant_id, internal_code, barcode, name, active_principle, drug_type, manufacturer, presentation, price, original_price, promotional_price, stock, category, grouping_slug, variant_attribute, image, is_featured, requires_prescription, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, video_uri, description, indications, usage, side_effects, contraindications, is_ai_enriched")
        .eq("tenant_id", tenantId);

      // Regra estrita: Na vitrine pública para o cliente final, NUNCA trafegar produtos com preço 0.00
      if (!isAdmin) {
        q = q.gt("price", 0);
      }

      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, from + step - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      } else {
        hasMore = false;
      }
    }

    // Deduplicate by ID
    const uniqueMap = new Map();
    for (const item of allData) {
      if (item && item.id) {
        if (!isAdmin && (Number(item.price) <= 0 || isNaN(Number(item.price)))) {
          continue;
        }
        uniqueMap.set(item.id, item);
      }
    }
    const uniqueProducts = Array.from(uniqueMap.values());

    // Se for requisição administrativa ou com cache-buster (?t=...), desativa cache para refletir alterações na hora
    if (isAdmin || req.query.t || req.query.nocache) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    } else {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=60, stale-while-revalidate=300",
      );
    }
    res.json({ data: uniqueProducts, total: uniqueProducts.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Rota de Vitrine Pública por Slug (/api/store/:slug)
app.get(["/api/store/:slug", "/api/v1/store/:slug"], async (req, res) => {
  try {
    const slug = req.params.slug;
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("*")
      .or(`slug.eq.${slug},id.eq.${slug}`)
      .maybeSingle();

    if (tErr || !tenant) {
      return res.status(404).json({ error: "Loja não encontrada" });
    }

    const { data: products } = await supabase
      .from("products")
      .select("id, tenant_id, internal_code, barcode, name, active_principle, drug_type, manufacturer, presentation, price, original_price, promotional_price, stock, category, grouping_slug, variant_attribute, image, is_featured, requires_prescription, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, video_uri, description, indications, usage, side_effects, contraindications, is_ai_enriched")
      .eq("tenant_id", tenant.id)
      .gt("price", 0)
      .order("is_featured", { ascending: false });

    return res.json({
      tenant,
      products: products || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dedicated Complete Products Export Endpoint (Unlimited, Paginated Stream/Chunking)
const handleProductsExport = async (req: express.Request, res: express.Response) => {
  try {
    const tenantId = req.params.tenantId || (req.query.tenantId as string);
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório" });
    }

    const format = ((req.query.format as string) || "csv").toLowerCase(); // 'csv', 'xlsx', or 'json'

    // Remoção total de limite de paginação: busca 100% dos produtos em lotes de 1.000 registros
    let allProducts: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      let { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(from, from + step - 1);

      // Fallback: se houver erro com ordenação por 'id', tenta sem order
      if (error) {
        const fallback = await supabase
          .from("products")
          .select("*")
          .eq("tenant_id", tenantId)
          .range(from, from + step - 1);
        if (fallback.error) throw fallback.error;
        data = fallback.data;
      }

      if (data && data.length > 0) {
        allProducts = allProducts.concat(data);
        if (data.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      } else {
        hasMore = false;
      }
    }

    // Deduplicação por ID
    const uniqueMap = new Map();
    for (const p of allProducts) {
      if (p && p.id) {
        uniqueMap.set(p.id, p);
      }
    }
    const finalProducts = uniqueMap.size > 0 ? Array.from(uniqueMap.values()) : allProducts;

    // 1. Formato JSON
    if (format === "json") {
      return res.json({ 
        success: true, 
        count: finalProducts.length, 
        data: finalProducts.map(p => ({
          ...p,
          promotionalPrice: p.promotional_price !== null && p.promotional_price !== undefined ? Number(p.promotional_price) : null,
          PRECO_PROMOCIONAL: p.promotional_price !== null && p.promotional_price !== undefined ? Number(p.promotional_price) : null,
          PROMOTIONAL_PRICE: p.promotional_price !== null && p.promotional_price !== undefined ? Number(p.promotional_price) : null
        }))
      });
    }

    // 2. Formato XLSX (Excel nativo)
    if (format === "xlsx" || format === "excel") {
      const excelRows = finalProducts.map(p => {
        const precoVenda = Number(p.price || 0);
        const precoOriginal = Number(p.original_price || p.originalPrice || 0);
        const promoVal = p.promotional_price !== null && p.promotional_price !== undefined 
          ? Number(p.promotional_price) 
          : (p.promotionalPrice !== null && p.promotionalPrice !== undefined ? Number(p.promotionalPrice) : null);

        return {
          'ID': p.id || '',
          'CODIGO_INTERNO': p.internal_code || p.internalCode || '',
          'EAN': p.barcode || '',
          'NOME_PRODUTO': p.name || '',
          'FABRICANTE': p.manufacturer || '',
          'CATEGORIA': p.category || 'Geral',
          'PRECO_VENDA': precoVenda,
          'PRECO_ORIGINAL': precoOriginal,
          'PRECO_PROMOCIONAL': promoVal !== null && promoVal > 0 ? promoVal : '',
          'PROMOTIONAL_PRICE': promoVal !== null && promoVal > 0 ? promoVal : '',
          'ESTOQUE': Number(p.stock ?? 0),
          'PRINCIPIO_ATIVO': p.active_principle || p.activePrinciple || '',
          'TIPO_MEDICAMENTO': p.drug_type || p.drugType || '',
          'APRESENTACAO': p.presentation || '',
          'DESCRICAO': p.description || '',
          'RETENCAO_RECEITA': p.requires_prescription ? 'SIM' : 'NÃO',
          'TIPO_PROMOCAO': p.promotion_type || 'NONE',
          'DESTAQUE': p.is_featured ? 'SIM' : 'NÃO',
          'DATA_CRIACAO': p.created_at || ''
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Produtos");
      const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=produtos_${tenantId}_${new Date().toISOString().split('T')[0]}.xlsx`,
      );
      return res.send(excelBuffer);
    }

    // 3. Formato CSV (com BOM UTF-8 e colunas completas)
    const headers = [
      "ID",
      "CODIGO_INTERNO",
      "EAN",
      "NOME_PRODUTO",
      "FABRICANTE",
      "CATEGORIA",
      "PRECO_VENDA",
      "PRECO_ORIGINAL",
      "PRECO_PROMOCIONAL",
      "PROMOTIONAL_PRICE",
      "ESTOQUE",
      "PRINCIPIO_ATIVO",
      "TIPO_MEDICAMENTO",
      "APRESENTACAO",
      "DESCRICAO",
      "RETENCAO_RECEITA",
      "TIPO_PROMOCAO",
      "DESTAQUE",
      "DATA_CRIACAO"
    ];

    const csvRows = [headers.join(";")];

    for (const p of finalProducts) {
      const precoVenda = Number(p.price || 0);
      const precoOriginal = Number(p.original_price || p.originalPrice || 0);
      const promoVal = p.promotional_price !== null && p.promotional_price !== undefined 
        ? Number(p.promotional_price) 
        : (p.promotionalPrice !== null && p.promotionalPrice !== undefined ? Number(p.promotionalPrice) : null);

      const formattedPrecoVenda = precoVenda > 0 ? precoVenda.toFixed(2).replace('.', ',') : '0,00';
      const formattedPrecoOriginal = precoOriginal > 0 ? precoOriginal.toFixed(2).replace('.', ',') : '';
      const formattedPromo = promoVal !== null && promoVal > 0 ? promoVal.toFixed(2).replace('.', ',') : '';

      const row = [
        `"${String(p.id || '').replace(/"/g, '""')}"`,
        `"${String(p.internal_code || p.internalCode || '').replace(/"/g, '""')}"`,
        `"${String(p.barcode || '').replace(/"/g, '""')}"`,
        `"${String(p.name || '').replace(/"/g, '""')}"`,
        `"${String(p.manufacturer || '').replace(/"/g, '""')}"`,
        `"${String(p.category || 'Geral').replace(/"/g, '""')}"`,
        formattedPrecoVenda,
        formattedPrecoOriginal,
        formattedPromo, // Coluna explícita PRECO_PROMOCIONAL
        formattedPromo, // Coluna explícita PROMOTIONAL_PRICE
        String(p.stock ?? 0),
        `"${String(p.active_principle || p.activePrinciple || '').replace(/"/g, '""')}"`,
        `"${String(p.drug_type || p.drugType || '').replace(/"/g, '""')}"`,
        `"${String(p.presentation || '').replace(/"/g, '""')}"`,
        `"${String(p.description || '').replace(/"/g, '""')}"`,
        p.requires_prescription ? 'SIM' : 'NAO',
        `"${String(p.promotion_type || 'NONE').replace(/"/g, '""')}"`,
        p.is_featured ? 'SIM' : 'NAO',
        `"${String(p.created_at || '').replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(";"));
    }

    const csvContent = "\uFEFF" + csvRows.join("\r\n"); // UTF-8 BOM para Excel
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=produtos_${tenantId}_${new Date().toISOString().split('T')[0]}.csv`,
    );
    return res.send(csvContent);
  } catch (err: any) {
    console.error("Erro na exportação de produtos:", err);
    res.status(500).json({ error: err.message });
  }
};

app.get("/api/v1/tenants/:tenantId/products/export", checkTenantAccess, handleProductsExport);
app.get("/api/tenants/:tenantId/products/export", checkTenantAccess, handleProductsExport);
app.get("/api/products/export/:tenantId", checkTenantAccess, handleProductsExport);
app.get("/api/v1/products/export/:tenantId", checkTenantAccess, handleProductsExport);
app.get("/api/v1/store/:tenantId/products/export", handleProductsExport);
app.get("/api/products/export", checkTenantAccess, handleProductsExport);

// ==============================================================================
// SINCRONIZAÇÃO E ENRIQUECIMENTO DE FOTOS POR CÓDIGO DE BARRAS (EAN)
// ==============================================================================
app.post("/api/products/sync-ean-images", async (req, res) => {
  try {
    const { productId, ean, tenantId, productIds, limit, concurrency, externalImageUrl } = req.body || {};

    // 1. Sincronização de um único produto ou persistência direta de URL externa
    if (productId || ean || externalImageUrl) {
      if (!ean && productId) {
        // Se foi enviado apenas o ID, busca os dados do produto no Supabase
        const { data: prod, error } = await supabaseAdmin
          .from("products")
          .select("id, name, barcode, tenant_id")
          .eq("id", productId)
          .maybeSingle();

        if (error || !prod || !prod.barcode) {
          return res.status(400).json({
            success: false,
            error: "Produto não encontrado ou sem código de barras (EAN) cadastrado."
          });
        }

        const result = await fetchAndStoreProductImageByEan(
          supabaseAdmin,
          prod.barcode,
          prod.name,
          prod.tenant_id,
          prod.id,
          externalImageUrl
        );
        return res.json(result);
      }

      // Se forneceu o EAN diretamente
      const result = await fetchAndStoreProductImageByEan(
        supabaseAdmin,
        ean,
        req.body?.productName,
        tenantId,
        productId,
        externalImageUrl
      );
      return res.json(result);
    }

    // 2. Processamento em lote
    const batchSummary = await syncEanImagesBatch(supabaseAdmin, {
      tenantId,
      productIds,
      limit: typeof limit === "number" ? Math.min(limit, 500) : 100,
      concurrency: typeof concurrency === "number" ? Math.min(concurrency, 5) : 3
    });

    return res.json({
      success: true,
      ...batchSummary
    });
  } catch (error: any) {
    console.error("[API sync-ean-images] Erro inesperado:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro interno ao sincronizar fotos por EAN."
    });
  }
});

app.post("/api/products/search-ean-image", async (req, res) => {
  try {
    const { ean, productName, tenantId, productId, externalImageUrl } = req.body || {};
    if (!ean) {
      return res.status(400).json({ success: false, error: "Parâmetro 'ean' é obrigatório." });
    }

    const result = await fetchAndStoreProductImageByEan(
      supabaseAdmin,
      ean,
      productName,
      tenantId,
      productId,
      externalImageUrl
    );
    return res.json(result);
  } catch (error: any) {
    console.error("[API search-ean-image] Erro inesperado:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro ao consultar foto do produto por EAN."
    });
  }
});

// Endpoint dedicado para persistir fotos encontradas pelo navegador do lojista (IP residencial brasileiro)
app.post("/api/products/save-external-image", async (req, res) => {
  try {
    const { ean, imageUrl, productName, tenantId, productId } = req.body || {};
    if (!ean || !imageUrl) {
      return res.status(400).json({ success: false, error: "Parâmetros 'ean' e 'imageUrl' são obrigatórios." });
    }

    const result = await fetchAndStoreProductImageByEan(
      supabaseAdmin,
      ean,
      productName,
      tenantId,
      productId,
      imageUrl
    );
    return res.json(result);
  } catch (error: any) {
    console.error("[API save-external-image] Erro inesperado:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro ao salvar imagem externa no Supabase Storage."
    });
  }
});

// Endpoint para limpar imagens inválidas (banners Meli+, ícones gavel/flaticon e genéricos sobrescritos)
app.post("/api/products/cleanup-corrupted-images", async (req, res) => {
  try {
    const tenantId = (req.body?.tenantId || req.body?.tenant_id || req.query?.tenantId || "").toString().trim() || undefined;
    const summary = await cleanupCorruptedEanImages(supabaseAdmin, tenantId);
    return res.json(summary);
  } catch (error: any) {
    console.error("[API cleanup-corrupted-images] Erro inesperado:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Erro ao limpar imagens inválidas do catálogo.",
    });
  }
});

/**
 * Motor Inteligente de Autocategorização em Lote (`POST /api/v1/products/auto-categorize`):
 * Reavalia TODOS os produtos da loja do zero (ignorando categorias erradas previamente salvas como "Snacks" ou "Produtos para o Dia a Dia"),
 * aplica a Regra de Ouro de blindagem de medicamentos/laboratórios e atualiza no Supabase todos os produtos cuja categoria mudou.
 */
app.post(
  ["/api/v1/products/auto-categorize", "/api/products/auto-categorize"],
  async (req, res) => {
    try {
      const tenantId = String(
        req.body?.tenantId ||
          req.body?.tenant_id ||
          req.query?.tenantId ||
          req.query?.tenant_id ||
          req.headers["x-tenant-id"] ||
          "",
      ).trim();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          error: "O 'tenantId' da farmácia é obrigatório para organizar as categorias.",
        });
      }

      const PAGE_SIZE = 1000;
      const ID_CHUNK_SIZE = 400;
      let from = 0;
      let hasMore = true;
      const allStoreProducts: any[] = [];

      while (hasMore) {
        const { data, error } = await supabaseAdmin
          .from("products")
          .select("id, name, manufacturer, category, active_principle, description, drug_type")
          .eq("tenant_id", tenantId)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          throw new Error(`Erro ao ler produtos da loja: ${error.message}`);
        }

        if (data && data.length > 0) {
          allStoreProducts.push(...data);
          if (data.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            from += PAGE_SIZE;
          }
        } else {
          hasMore = false;
        }
      }

      const idsByTargetCategory = new Map<string, string[]>();
      const breakdownByCategory: Record<string, number> = {};
      const updatedBreakdownByCategory: Record<string, number> = {};
      const sampleChanges: Array<{
        id: string;
        name: string;
        oldCategory: string;
        newCategory: string;
        newDepartment: string;
      }> = [];

      for (const prod of allStoreProducts) {
        // Reavalia do zero ignorando prod.category antigo (que pode estar sujo com "Snacks" ou "Produtos para o Dia a Dia")
        const strictRes = classifyProductCategory(
          prod.name || "",
          prod.manufacturer || "",
          "",
          prod.active_principle || "",
          prod.description || "",
          prod.drug_type || "",
        );

        const targetCategory = strictRes.subcategory;
        const targetDepartment = strictRes.department;

        breakdownByCategory[targetCategory] = (breakdownByCategory[targetCategory] || 0) + 1;

        const currentCat = String(prod.category || "").trim();
        if (currentCat !== targetCategory) {
          let list = idsByTargetCategory.get(targetCategory);
          if (!list) {
            list = [];
            idsByTargetCategory.set(targetCategory, list);
          }
          list.push(prod.id);
          updatedBreakdownByCategory[targetCategory] =
            (updatedBreakdownByCategory[targetCategory] || 0) + 1;

          if (sampleChanges.length < 30) {
            sampleChanges.push({
              id: prod.id,
              name: prod.name,
              oldCategory: currentCat || "Sem Categoria",
              newCategory: targetCategory,
              newDepartment: targetDepartment,
            });
          }
        }
      }

      let updatedCount = 0;
      for (const [targetCat, productIds] of idsByTargetCategory.entries()) {
        for (let i = 0; i < productIds.length; i += ID_CHUNK_SIZE) {
          const idChunk = productIds.slice(i, i + ID_CHUNK_SIZE);
          const { error: updateErr } = await supabaseAdmin
            .from("products")
            .update({ category: targetCat })
            .eq("tenant_id", tenantId)
            .in("id", idChunk);

          if (updateErr) {
            console.error(
              `[auto-categorize] Erro ao atualizar categoria "${targetCat}" (${idChunk.length} itens):`,
              updateErr.message,
            );
          } else {
            updatedCount += idChunk.length;
          }
        }
      }

      return res.json({
        success: true,
        totalScanned: allStoreProducts.length,
        updatedCount,
        unchangedCount: allStoreProducts.length - updatedCount,
        breakdownByCategory,
        updatedBreakdownByCategory,
        sampleChanges,
        message:
          updatedCount > 0
            ? `${allStoreProducts.length} produtos analisados do zero (${updatedCount} tiveram a categoria corrigida no banco de dados)!`
            : `Todos os ${allStoreProducts.length} produtos foram reavaliados do zero e já estão nas categorias corretas!`,
      });
    } catch (error: any) {
      console.error("[API auto-categorize] Erro inesperado:", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Erro ao reorganizar categorias automaticamente.",
      });
    }
  },
);

app.get("/api/v1/products/:id", async (req, res) => {
  try {
    const rawId = req.params.id;
    const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();

    // 1. Tenta buscar por ID direto (filtrando por tenantId se informado)
    let idQuery = supabase
      .from("products")
      .select("*")
      .eq("id", rawId);
    if (tenantId) {
      idQuery = idQuery.eq("tenant_id", tenantId);
    }
    const { data: byId, error: errId } = await idQuery.maybeSingle();

    if (!errId && byId) {
      return res.json(byId);
    }

    // 2. Fallback: Tenta por internal_code ou barcode
    let codeQuery = supabase
      .from("products")
      .select("*")
      .or(`internal_code.eq.${rawId},barcode.eq.${rawId}`);
    if (tenantId) {
      codeQuery = codeQuery.eq("tenant_id", tenantId);
    }
    const { data: byCode } = await codeQuery.limit(1).maybeSingle();

    if (byCode) {
      return res.json(byCode);
    }

    // 3. Fallback: Tenta por aproximação de nome
    let nameQuery = supabase
      .from("products")
      .select("*")
      .ilike("name", `%${rawId}%`);
    if (tenantId) {
      nameQuery = nameQuery.eq("tenant_id", tenantId);
    }
    const { data: byName } = await nameQuery.limit(1).maybeSingle();

    if (byName) {
      return res.json(byName);
    }

    return res.status(404).json({ error: "Produto não encontrado" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/tenants/admin", async (req, res) => {
  try {
    const { payload, isUpdate } = req.body;

    // Padronização e Enriquecimento Automático para Onboarding Plug-and-Play
    const enrichedPayload = { ...payload };
    const pharmacyName = enrichedPayload.name || "Nossa Drogaria";
    const pharmacySlug = enrichedPayload.slug || (enrichedPayload.id ? String(enrichedPayload.id).replace(/^store_/, '') : '');
    if (!enrichedPayload.slug && pharmacySlug) {
      enrichedPayload.slug = pharmacySlug;
    }
    const resolvedLogoVal = (enrichedPayload.logo_url || enrichedPayload.logo || "").trim();
    if (resolvedLogoVal) {
      enrichedPayload.logo_url = resolvedLogoVal;
      enrichedPayload.logo = resolvedLogoVal;
    }

    if (!enrichedPayload.welcome_message_text) {
      enrichedPayload.welcome_message_text = `Olá! Sou o assistente virtual da ${pharmacyName}. Em que posso te ajudar hoje?`;
    }
    if (enrichedPayload.welcome_message_enabled === undefined) {
      enrichedPayload.welcome_message_enabled = true;
    }
    if (!enrichedPayload.welcome_message_format) {
      enrichedPayload.welcome_message_format = "button";
    }
    if (enrichedPayload.is_chat_enabled === undefined) {
      enrichedPayload.is_chat_enabled = true;
    }
    if (enrichedPayload.is_ai_agent_enabled === undefined) {
      enrichedPayload.is_ai_agent_enabled = true;
    }
    if (enrichedPayload.is_ai_copilot_enabled === undefined) {
      enrichedPayload.is_ai_copilot_enabled = true;
    }

    const defaultStoreLink = enrichedPayload.welcome_message_link || (pharmacySlug ? `https://${pharmacySlug}.farmaflow.online` : '');
    if (!enrichedPayload.welcome_message_link && defaultStoreLink) {
      enrichedPayload.welcome_message_link = defaultStoreLink;
    }

    if (!enrichedPayload.ai_agent_config || typeof enrichedPayload.ai_agent_config !== 'object') {
      enrichedPayload.ai_agent_config = {
        active: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        systemPrompt: DEFAULT_AI_AGENT_PROMPT,
        fallbackMessage: "Desculpe, estou com uma instabilidade momentânea. Um de nossos atendentes humanos responderá sua mensagem em breve!",
        transitionToHumanMessage: "Perfeito! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido.",
        maxTokens: 500,
        temperature: 0.7,
        maxInteractionsPerSession: 4,
        antiAbuseGuardrailsEnabled: true,
        strictStoreLinkEnforcement: true,
        storeLink: defaultStoreLink
      };
    }

    // Tratamento seguro e isolado por tenant_id para Login da API e Senha da API do Inovafarma
    let existingTenantRow: any = null;
    if (enrichedPayload.id) {
      const { data: existingData } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", enrichedPayload.id)
        .maybeSingle();
      existingTenantRow = existingData;
    }

    const existingErpConfig = existingTenantRow
      ? extractTenantErpConfig(existingTenantRow)
      : null;

    const rawIncomingErpBaseUrl =
      enrichedPayload.erp_base_url !== undefined ||
      enrichedPayload.erpBaseUrl !== undefined ||
      enrichedPayload.erp_url !== undefined ||
      enrichedPayload.erpUrl !== undefined
        ? String(
            enrichedPayload.erp_base_url ??
              enrichedPayload.erpBaseUrl ??
              enrichedPayload.erp_url ??
              enrichedPayload.erpUrl ??
              "",
          ).trim()
        : existingErpConfig?.erp_base_url || "";

    const rawIncomingErpRouteId =
      enrichedPayload.erp_route_id !== undefined ||
      enrichedPayload.erpRouteId !== undefined
        ? String(enrichedPayload.erp_route_id ?? enrichedPayload.erpRouteId ?? "").trim()
        : existingErpConfig?.erp_route_id || "";

    const parsedIncomingErp = parseInovafarmaUrlAndRoute(
      rawIncomingErpBaseUrl,
      rawIncomingErpRouteId,
    );
    const incomingErpBaseUrl = rawIncomingErpBaseUrl
      ? parsedIncomingErp.origin
      : "";
    const incomingErpRouteId = parsedIncomingErp.slug || INOVAFARMA_DEFAULT_ROUTE_ID;

    const incomingErpCnpj =
      enrichedPayload.erp_cnpj !== undefined ||
      enrichedPayload.erpCnpj !== undefined ||
      enrichedPayload.cnpj !== undefined
        ? sanitizeCnpj(
            enrichedPayload.erp_cnpj ??
              enrichedPayload.erpCnpj ??
              enrichedPayload.cnpj ??
              "",
          )
        : existingErpConfig?.erpCnpj || "";

    const incomingErpApiKey =
      enrichedPayload.erp_api_key !== undefined ||
      enrichedPayload.erpApiKey !== undefined
        ? String(enrichedPayload.erp_api_key ?? enrichedPayload.erpApiKey ?? "").trim()
        : existingErpConfig?.erpApiKey || "";

    const incomingErpLogin =
      enrichedPayload.erp_login !== undefined ||
      enrichedPayload.erp_api_login !== undefined ||
      enrichedPayload.erpApiLogin !== undefined
        ? String(
            enrichedPayload.erp_login ??
              enrichedPayload.erp_api_login ??
              enrichedPayload.erpApiLogin ??
              "",
          ).trim()
        : existingTenantRow
          ? extractTenantErpLogin(existingTenantRow)
          : "";

    const rawIncomingErpPassword = String(
      enrichedPayload.erp_password ??
        enrichedPayload.erp_api_password ??
        enrichedPayload.erpApiPassword ??
        enrichedPayload.smart_banners?._erpCredentials?.erp_api_password ??
        "",
    ).trim();

    let finalEncryptedErpPassword = "";
    let passwordChanged = false;
    if (rawIncomingErpPassword && !isMaskedErpPassword(rawIncomingErpPassword)) {
      finalEncryptedErpPassword = encryptErpPassword(
        rawIncomingErpPassword,
        String(enrichedPayload.id || ""),
      );
      passwordChanged = true;
    } else if (existingTenantRow) {
      const existingPlain = extractTenantErpPassword(existingTenantRow);
      if (existingPlain) {
        finalEncryptedErpPassword = encryptErpPassword(
          existingPlain,
          String(enrichedPayload.id || ""),
        );
      }
    }

    delete enrichedPayload.erpBaseUrl;
    delete enrichedPayload.erpRouteId;
    delete enrichedPayload.erpCnpj;
    delete enrichedPayload.erpApiKey;
    delete enrichedPayload.erpApiLogin;
    delete enrichedPayload.erpApiPassword;
    delete enrichedPayload.hasErpApiPassword;
    delete enrichedPayload.has_erp_api_password;
    delete enrichedPayload.erpTokenExpiration;
    delete enrichedPayload.lastProductSync;
    delete enrichedPayload.lastCustomerSync;

    if (incomingErpBaseUrl) {
      enrichedPayload.erp_url = incomingErpBaseUrl;
      enrichedPayload.erp_base_url = incomingErpBaseUrl;
    }
    enrichedPayload.erp_route_id = incomingErpRouteId;
    enrichedPayload.erp_cnpj = incomingErpCnpj;
    enrichedPayload.erp_api_key = incomingErpApiKey;
    enrichedPayload.erp_login = incomingErpLogin;
    enrichedPayload.erp_api_login = incomingErpLogin;
    if (finalEncryptedErpPassword) {
      enrichedPayload.erp_password = finalEncryptedErpPassword;
      enrichedPayload.erp_api_password = finalEncryptedErpPassword;
    } else {
      delete enrichedPayload.erp_password;
      delete enrichedPayload.erp_api_password;
    }

    const existingCredsFromTenant =
      existingTenantRow?.smart_banners?._erpCredentials &&
      typeof existingTenantRow.smart_banners._erpCredentials === "object"
        ? existingTenantRow.smart_banners._erpCredentials
        : {};

    enrichedPayload.smart_banners = {
      ...(existingTenantRow?.smart_banners && typeof existingTenantRow.smart_banners === "object"
        ? existingTenantRow.smart_banners
        : {}),
      ...(enrichedPayload.smart_banners && typeof enrichedPayload.smart_banners === "object"
        ? enrichedPayload.smart_banners
        : {}),
      _erpCredentials: {
        ...existingCredsFromTenant,
        erp_base_url: incomingErpBaseUrl,
        erp_route_id: incomingErpRouteId,
        erp_cnpj: incomingErpCnpj,
        erp_api_key: incomingErpApiKey,
        erp_login: incomingErpLogin,
        erp_api_login: incomingErpLogin,
        ...(finalEncryptedErpPassword
          ? { erp_api_password_enc: finalEncryptedErpPassword }
          : {}),
        ...(passwordChanged
          ? { erp_access_token: "", erp_token_expiration: "" }
          : {}),
        updated_at: new Date().toISOString(),
      },
    };
    delete enrichedPayload.smart_banners._erpCredentials.erp_api_password;

    let tenantData: any = null;

    const stripStructuredHoursFields = (obj: any) => {
      const copy = { ...obj };
      delete copy.opening_time_weekdays;
      delete copy.closing_time_weekdays;
      delete copy.opening_time_saturdays;
      delete copy.closing_time_saturdays;
      delete copy.opening_time_sundays;
      delete copy.closing_time_sundays;
      delete copy.closed_on_sundays;
      delete copy.is_24_hours;
      delete copy.erp_base_url;
      delete copy.erp_route_id;
      delete copy.erp_cnpj;
      delete copy.erp_login;
      delete copy.erp_password;
      delete copy.erp_api_key;
      delete copy.erp_access_token;
      delete copy.erp_token_expiration;
      delete copy.last_product_sync;
      delete copy.last_customer_sync;
      delete copy.erp_api_login;
      delete copy.erp_api_password;
      return copy;
    };

    const stripRegulatoryFields = (obj: any) => {
      const copy = stripStructuredHoursFields(obj);
      delete copy.razao_social;
      delete copy.farmaceutico_responsavel;
      delete copy.crf;
      delete copy.horario_funcionamento;
      delete copy.telefone_contato;
      return copy;
    };

    if (isUpdate) {
      let { data, error } = await supabase
        .from("tenants")
        .upsert(enrichedPayload)
        .select();
      if (error && (error.code === "42703" || error.message?.includes("does not exist"))) {
        console.warn("[TENANTS ADMIN] Coluna estruturada não encontrada em tenants, tentando mantendo campos regulatórios:", error.message);
        const firstFallbackPayload = stripStructuredHoursFields(enrichedPayload);
        const firstRetry = await supabase.from("tenants").upsert(firstFallbackPayload).select();
        if (firstRetry.error && (firstRetry.error.code === "42703" || firstRetry.error.message?.includes("does not exist"))) {
          const cleanPayload = stripRegulatoryFields(enrichedPayload);
          const secondRetry = await supabase.from("tenants").upsert(cleanPayload).select();
          if (secondRetry.error) throw secondRetry.error;
          data = secondRetry.data;
        } else if (firstRetry.error) {
          throw firstRetry.error;
        } else {
          data = firstRetry.data;
        }
      } else if (error) {
        throw error;
      }
      tenantData = data;
    } else {
      let { data, error } = await supabase
        .from("tenants")
        .insert(enrichedPayload)
        .select();
      if (error && (error.code === "42703" || error.message?.includes("does not exist"))) {
        console.warn("[TENANTS ADMIN] Coluna estruturada não encontrada em tenants (insert), tentando mantendo campos regulatórios:", error.message);
        const firstFallbackPayload = stripStructuredHoursFields(enrichedPayload);
        const firstRetry = await supabase.from("tenants").insert(firstFallbackPayload).select();
        if (firstRetry.error && (firstRetry.error.code === "42703" || firstRetry.error.message?.includes("does not exist"))) {
          const cleanPayload = stripRegulatoryFields(enrichedPayload);
          const secondRetry = await supabase.from("tenants").insert(cleanPayload).select();
          if (secondRetry.error) throw secondRetry.error;
          data = secondRetry.data;
        } else if (firstRetry.error) {
          throw firstRetry.error;
        } else {
          data = firstRetry.data;
        }
      } else if (error) {
        throw error;
      }
      tenantData = data;
    }

    // Onboarding Automático de Estrutura de Atendimento (Inboxes & Instâncias WhatsApp)
    const savedTenant = (Array.isArray(tenantData) ? tenantData[0] : tenantData) || enrichedPayload;
    const targetStoreId = savedTenant.id || enrichedPayload.id;

    if (targetStoreId) {
      // 1. Garantir Caixa de Entrada Padrão na tabela inboxes
      try {
        const { data: existingInbox } = await supabaseAdmin
          .from("inboxes")
          .select("id")
          .eq("store_id", targetStoreId)
          .limit(1)
          .maybeSingle();

        if (!existingInbox) {
          await supabaseAdmin.from("inboxes").insert({
            store_id: targetStoreId,
            name: "WhatsApp Principal",
            description: "Canal de atendimento padrão via WhatsApp"
          });
          console.log(`[ONBOARDING] Caixa de entrada padrão criada para a drogaria "${pharmacyName}" (${targetStoreId})`);
        }
      } catch (inboxErr: any) {
        console.warn("[ONBOARDING] Aviso ao criar inbox padrão:", inboxErr.message);
      }

      // 2. Garantir Instância do WhatsApp na tabela whatsapp_instances
      try {
        const rawSlug = savedTenant.slug || targetStoreId;
        const cleanSlug = String(rawSlug).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        const defaultInstanceName = cleanSlug.startsWith('store_') ? cleanSlug : `store_${cleanSlug}`;

        const { data: existingInst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id")
          .or(`store_id.eq.${targetStoreId},instance_name.eq.${defaultInstanceName}`)
          .limit(1)
          .maybeSingle();

        if (!existingInst) {
          await supabaseAdmin.from("whatsapp_instances").insert({
            store_id: targetStoreId,
            instance_name: defaultInstanceName,
            status: "DISCONNECTED"
          });
          console.log(`[ONBOARDING] Registro de instância WhatsApp criado automaticamente: "${defaultInstanceName}" (${targetStoreId})`);
        }
      } catch (instErr: any) {
        console.warn("[ONBOARDING] Aviso ao criar whatsapp_instance padrão:", instErr.message);
      }
    }

    // Atualizar imediatamente o cache em RAM de metadados/OpenGraph da loja e otimizar logo > 200KB
    allTenantsRamCache = null;
    if (savedTenant && targetStoreId) {
      storeTenantInRamCache(savedTenant, [targetStoreId, savedTenant.slug || targetStoreId]);
      const candidateLogoUrl = String(savedTenant.logo_url || savedTenant.logo || "").trim();
      if (candidateLogoUrl.startsWith("http")) {
        void (async () => {
          try {
            const checkRes = await fetch(candidateLogoUrl);
            if (!checkRes.ok) return;
            const origBuf = Buffer.from(await checkRes.arrayBuffer());
            if (origBuf.length > 200 * 1024) {
              const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(candidateLogoUrl)}&w=600&h=600&fit=cover&output=jpg&q=82`;
              const optRes = await fetch(wsrvUrl);
              if (!optRes.ok) return;
              const optBuf = Buffer.from(await optRes.arrayBuffer());
              const safeId = String(targetStoreId).replace(/[^a-zA-Z0-9_-]/g, "_");
              const newPath = `logos/${safeId}_logo_og_${Date.now()}.jpg`;
              const { error: upErr } = await supabaseAdmin.storage
                .from("product-images")
                .upload(newPath, optBuf, {
                  contentType: "image/jpeg",
                  cacheControl: "86400",
                  upsert: true,
                });
              if (!upErr) {
                const { data: pubData } = supabaseAdmin.storage.from("product-images").getPublicUrl(newPath);
                if (pubData?.publicUrl) {
                  await supabaseAdmin
                    .from("tenants")
                    .update({ logo_url: pubData.publicUrl, logo: pubData.publicUrl })
                    .eq("id", targetStoreId);
                  savedTenant.logo_url = pubData.publicUrl;
                  savedTenant.logo = pubData.publicUrl;
                  storeTenantInRamCache(savedTenant, [targetStoreId, savedTenant.slug || targetStoreId]);
                  allTenantsRamCache = null;
                  console.log(`[OG_LOGO_OPTIMIZER] Logo de ${targetStoreId} otimizada automaticamente (${Math.round(origBuf.length / 1024)}KB -> ${Math.round(optBuf.length / 1024)}KB): ${pubData.publicUrl}`);
                }
              }
            }
          } catch (_) {}
        })();
      }
    }

    const sanitizedResult = Array.isArray(tenantData)
      ? tenantData.map((row) => sanitizeTenantErpCredentialsForClient(row))
      : tenantData
        ? sanitizeTenantErpCredentialsForClient(tenantData)
        : tenantData;

    res.json({ data: sanitizedResult });
  } catch (e: any) {
    console.error("[ONBOARDING ERROR]:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/admin/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await supabase.from("products").delete().eq("tenant_id", id);
    await supabase.from("orders").delete().eq("tenant_id", id);
    const { data, error } = await supabase
      .from("tenants")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Initialize Storage Bucket
async function initStorage() {
  if (process.env.VERCEL) return; // Skip on Vercel to avoid cold start issues
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    const backupsExists = buckets?.some((b) => b.id === "backups_empresas");
    if (!backupsExists) {
      console.log("[Storage] Creating bucket 'backups_empresas'...");
      await supabase.storage.createBucket("backups_empresas", {
        public: false,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: ["text/plain", "application/sql", "text/csv"],
      });
    }

    const prescriptionsExists = buckets?.some((b) => b.id === "medical-prescriptions");
    if (!prescriptionsExists) {
      console.log("[Storage] Creating bucket 'medical-prescriptions'...");
      await supabase.storage.createBucket("medical-prescriptions", {
        public: true,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf", "image/webp"],
      });
    }
  } catch (err) {
    console.error("[Storage] Error initializing buckets:", err);
  }
}
initStorage();

// --- CRON JOBS ---
// Disabled on Vercel as serverless functions are not persistent
if (!process.env.VERCEL) {
  /**
   * 1. Auto-Purge Reviews
   * Runs every day at 00:00
   */
  cron.schedule("0 0 * * *", async () => {
    console.log("[Cron] Starting Auto-Purge of Reviews...");
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateStr = sevenDaysAgo.toISOString();

      // Before deleting, update stats to preserve the rating
      // We fetch reviews that are about to be deleted
      const { data: reviewsToDelete } = await supabase
        .from("app_reviews")
        .select("*")
        .lt("created_at", dateStr);

      if (reviewsToDelete && reviewsToDelete.length > 0) {
        // Group by tenantId to update stats
        const tenants = [...new Set(reviewsToDelete.map((r) => r.tenant_id))];

        for (const tenant_id of tenants) {
          // Fetch current stats or all reviews to calculate fixed rating
          const { data: allReviews } = await supabase
            .from("app_reviews")
            .select("rating")
            .eq("tenant_id", tenant_id);

          if (allReviews && allReviews.length > 0) {
            const total = allReviews.length;
            const avg =
              allReviews.reduce((acc, r) => acc + r.rating, 0) / total;

            // Update or Insert into pharmacy_stats
            await supabase.from("pharmacy_stats").upsert(
              {
                tenantid: tenant_id,
                averagerating: avg,
                totalreviews: total,
                lastupdated: new Date().toISOString(),
              },
              { onConflict: "tenantid" },
            );
          }
        }

        // Perform Hard Delete
        const { error } = await supabase
          .from("app_reviews")
          .delete()
          .lt("created_at", dateStr);

        if (error) throw error;
        console.log(
          `[Cron] Auto-Purge completed. Deleted ${reviewsToDelete.length} reviews.`,
        );
      } else {
        console.log("[Cron] No reviews to purge.");
      }
    } catch (error) {
      console.error("[Cron] Error in Auto-Purge:", error);
    }
  });

  /**
   * 2. Automated Backups
   * Runs every day at 01:00 to check which companies need backup
   */
  cron.schedule("0 1 * * *", async () => {
    console.log("[Cron] Checking for scheduled backups...");
    const today = new Date();
    const dayOfMonth = today.getDate();
    const dayOfWeek = today.getDay(); // 0 = Sunday

    try {
      const { data: schedules } = await supabase
        .from("backupschedules")
        .select("*");

      if (!schedules) return;

      for (const schedule of schedules) {
        const config = schedule.backupconfig;
        if (!config || config.frequency === "OFF") continue;

        let shouldBackup = false;

        if (config.frequency === "WEEKLY" && dayOfWeek === 0) {
          shouldBackup = true;
        } else if (
          config.frequency === "BIWEEKLY" &&
          (dayOfMonth === 1 || dayOfMonth === 15)
        ) {
          shouldBackup = true;
        } else if (config.frequency === "MONTHLY" && dayOfMonth === 1) {
          shouldBackup = true;
        }

        if (shouldBackup) {
          await runBackup(schedule.tenantid);
        }
      }
    } catch (error) {
      console.error("[Cron] Error in Backup Scheduler:", error);
    }
  });

  /**
   * 3. Conciliação Noturna (Sincronização de Estoque)
   * Runs every day at 03:00
   */
  cron.schedule("0 3 * * *", async () => {
    console.log(
      "[Cron] Starting Nightly Reconciliation (Conciliação Noturna)...",
    );
    try {
      // Busca todas as farmácias que têm integração configurada (erp_url)
      const { data: tenants } = await supabase
        .from("tenants")
        .select("id, erp_url, integration_token")
        .not("erp_url", "is", null)
        .neq("erp_url", "");

      if (!tenants || tenants.length === 0) {
        console.log(
          "[Cron] No tenants with ERP URL configured for reconciliation.",
        );
        return;
      }

      for (const tenant of tenants) {
        try {
          if (!tenant.erp_url) continue;

          const sanitizedUrl = tenant.erp_url.startsWith('http://') || tenant.erp_url.startsWith('https://') 
              ? tenant.erp_url 
              : `https://${tenant.erp_url}`;
              
          console.log(`[AGENTE] Iniciando conciliação para tenant ${tenant.id}...`);
          console.log(`[AGENTE] Status: ONLINE para tenant ${tenant.id}`);
          
          try {
            await supabaseAdmin.from('agent_integrations').upsert({ 
              tenant_id: tenant.id,
              last_seen: new Date().toISOString(), 
              is_active: true 
            }, { onConflict: 'tenant_id' });
          } catch (e) {}
          
          console.log(`[Cron] Reconciling tenant ${tenant.id} with ERP ${sanitizedUrl}...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          let response: Response;
          try {
            response = await fetch(`${sanitizedUrl}/api/stock-dump`, {
              headers: {
                "x-api-key": tenant.integration_token || "",
              },
              signal: controller.signal,
            });
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            const errorMsg = fetchErr.name === 'AbortError' 
              ? `Tempo limite excedido (8s) ao conectar no ERP (${sanitizedUrl})`
              : `ERP inacessível ou sem conexão (${sanitizedUrl}): ${fetchErr.message || 'fetch failed'}`;
            throw new Error(errorMsg);
          }
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(
              `ERP returned ${response.status} ${response.statusText}`,
            );
          }

          const erpStockDump = await response.json(); // Array de { ean, internalCode, stock }

          // Busca o estoque atual do NexoIA
          const { data: nexoProducts } = await supabase
            .from("products")
            .select("id, barcode, internal_code, stock")
            .eq("tenant_id", tenant.id);

          if (!nexoProducts) continue;

          let updatedCount = 0;

          // Compara e corrige EXCLUSIVAMENTE por EAN (barcode)
          for (const erpItem of erpStockDump) {
            if (!erpItem.ean) continue;
            const nexoProduct = nexoProducts.find(
              (p) => p.barcode && String(p.barcode).trim() === String(erpItem.ean).trim(),
            );

            if (nexoProduct && nexoProduct.stock !== erpItem.stock) {
              try {
                await supabase
                  .from("products")
                  .update({ stock: erpItem.stock })
                  .eq("id", nexoProduct.id);
                updatedCount++;
              } catch (e: any) {
                console.error(`[Cron] Failed to update product ${nexoProduct.id}:`, e.message);
              }
            }
          }

          console.log(
            `[Cron] Reconciled ${updatedCount} products for tenant ${tenant.id}.`,
          );

          await logIntegration(
            tenant.id,
            "CRON /reconciliation",
            { updatedCount },
            "SUCCESS",
          );
        } catch (err: any) {
          console.error(
            `[Cron] Failed to reconcile tenant ${tenant.id}:`,
            err.message,
          );
          await logIntegration(
            tenant.id,
            "CRON /reconciliation",
            {},
            "FAILED",
            err.message,
          );
        }
      }
    } catch (error) {
      console.error("[Cron] Error in Nightly Reconciliation:", error);
    }
  });
}

// --- BACKUP LOGIC ---

/**
 * Helper to fetch all records from a table using pagination
 * to bypass the 1000 row limit of Supabase/PostgREST
 */
async function fetchAll(
  table: string,
  tenantId: string,
  column: string = "tenant_id",
  orderBy: string = "created_at",
) {
  let allData: any[] = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(column, tenantId)
      // Sorting is essential for stable pagination using range()
      .order(orderBy, { ascending: true })
      .range(from, from + step - 1);

    if (error) throw new Error(`[${table}] Pagination error: ${error.message}`);

    if (data && data.length > 0) {
      allData = [...allData, ...data];
      if (data.length < step) {
        hasMore = false;
      } else {
        from += step;
      }
    } else {
      hasMore = false;
    }
  }
  return allData;
}

async function runBackup(tenantId: string) {
  console.log(`[Backup] Starting backup for tenant: ${tenantId}`);
  try {
    // 0. Pre-connection validation: ensures database/pool is responsive before proceeding
    const { error: poolError } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);
    if (poolError) {
      throw new Error(`Database connection check failed: ${poolError.message}`);
    }

    // 1. Fetch Data with Pagination sequentially to reduce peak memory usage
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .single();
    if (tenantError)
      throw new Error(`Tenant fetch error: ${tenantError.message}`);

    const products = await fetchAll("products", tenantId, "tenant_id", "id");
    const orders = await fetchAll("orders", tenantId, "tenant_id", "id");
    const reviews = await fetchAll("app_reviews", tenantId, "tenant_id", "id");

    const backupData = {
      tenantId,
      timestamp: new Date().toISOString(),
      version: "1.0",
      data: {
        tenant: tenantData || null,
        products: (products || []).map((p) => {
          let deptId = null;
          let deptName = "Outros";
          let subcatName = p.category || "Geral";
          if (tenantData?.departments) {
            const depts = tenantData.departments;
            deptName = getDepartmentForCategory(p.category, depts);
            const dept = depts.find((d: any) => d.name === deptName);
            if (dept) {
              deptId = dept.id;
            }
          }
          return {
            ...p,
            department_id: deptId,
            department_name: deptName,
            subcategory_name: subcatName,
            subcategory_id: subcatName, // for backward compatibility/consistency
          };
        }),
        orders: orders || [],
        reviews: reviews || [],
      },
    };

    // 2. Generate File Content
    const fileName = `backup_empresa_${tenantId}.json`;
    const fileContent = JSON.stringify(backupData);

    // 3. Upload to Supabase Storage (Overwrite)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("backups_empresas")
      .upload(`${tenantId}/ultimo_backup.json`, fileContent, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) {
      console.error("[Backup] Storage upload error:", uploadError);
      throw new Error(`Storage upload error: ${uploadError.message}`);
    }

    // 4. Log Backup
    const { error: insertError } = await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: fileName,
      filesize: fileContent.length,
      status: "SUCCESS",
    });
    if (insertError) {
      console.error("[Backup] Error inserting log:", insertError);
    }

    // 5. Update last backup date in tenant config and backupschedules
    const { data: scheduleData } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();
    if (scheduleData) {
      const currentConfig = scheduleData.backupconfig || {};
      const newConfig = {
        ...currentConfig,
        lastBackup: new Date().toISOString(),
      };
      await supabase
        .from("backupschedules")
        .update({ backupconfig: newConfig })
        .eq("tenantid", tenantId);
      // Also update tenants for backward compatibility
      await supabase
        .from("tenants")
        .update({ backup_config: newConfig })
        .eq("id", tenantId);
    }

    console.log(`[Backup] Backup successful for ${tenantId}: ${fileName}`);
    return { success: true, fileName, insertError: insertError || null };
  } catch (error: any) {
    console.error(`[Backup] Failed for ${tenantId}:`, error);
    const actualErrorMessage = error?.message || String(error);
    const errorFilename = actualErrorMessage.substring(0, 150); // Store truncated error in filename column
    const { error: insertError } = await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: `ERRO: ${errorFilename}`, // Salvando erro real no filename para o painel mostrar
      filesize: 0,
      status: "FAILED",
    });
    if (insertError) {
      console.error("[Backup] Error inserting failure log:", insertError);
    }
    return { success: false, error: actualErrorMessage };
  }
}

// --- API ROUTES ---

app.get("/api/image-proxy", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || typeof url !== "string")
      return res.status(400).send("No URL provided");

    // Validate protocol
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return res.status(400).send("Invalid URL");
    }

    let response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
    } catch (e) {
      console.log(
        `[Image Proxy] Fetch threw for ${url}, falling back to wsrv.nl`,
      );
    }

    if (!response || (!response.ok && response.status === 403)) {
      if (response) {
        console.log(`[Image Proxy] 403 for ${url}, falling back to wsrv.nl`);
      }
      const fallbackUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
      response = await fetch(fallbackUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
    }

    if (!response.ok)
      return res
        .status(response.status)
        .send(`Failed to fetch image: ${response.statusText}`);

    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("Image proxy error:", e);
    res.status(500).send("Proxy error");
  }
});

app.get("/api/test-route", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/backups-all", async (req, res) => {
  try {
    console.log("HIT /api/backups-all");
    const { data, error } = await supabase.from("backuplogs").select("*");
    console.log("DATA:", data, "ERROR:", error);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
      .from("backuplogs")
      .select("*")
      .eq("tenantid", tenantId)
      .order("createdat", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(
      (data || []).map((log: any) => ({
        id: log.id,
        tenantId: log.tenantid,
        date: log.createdat,
        fileName: log.filename,
        fileSize: log.filesize,
        status: log.status,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backups/run/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const result = await runBackup(tenantId);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/config/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();

    if (error && error.code !== "PGRST116") {
      return res.status(500).json({ error: error.message });
    }

    res.json(data?.backupconfig || { frequency: "OFF" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backups/config/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { config } = req.body;

    // Update in backupschedules
    const { error: scheduleError } = await supabase
      .from("backupschedules")
      .upsert(
        {
          tenantid: tenantId,
          backupconfig: config,
          updatedat: new Date().toISOString(),
        },
        { onConflict: "tenantid" },
      );

    // Also update in tenants for backward compatibility
    const { error: tenantError } = await supabase
      .from("tenants")
      .update({ backup_config: config })
      .eq("id", tenantId);

    if (scheduleError)
      return res.status(500).json({ error: scheduleError.message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXPORT ENDPOINTS ---

app.get("/api/backups/export/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const { format } = req.query; // 'sql' or 'csv'

    // Fetch Data with Pagination
    const [tenantResult, products, orders, reviews] = await Promise.all([
      supabase.from("tenants").select("*").eq("id", tenantId).single(),
      fetchAll("products", tenantId, "tenant_id", "id"),
      fetchAll("orders", tenantId, "tenant_id", "id"),
      fetchAll("app_reviews", tenantId, "tenant_id", "id"),
    ]);

    if (format === "csv") {
      // For CSV, we'll combine key data into one or just pick one table?
      // Usually CSV export is per table. Let's provide a ZIP or just products for now as example,
      // or better, a combined CSV if requested.
      // But user said "conferência em Excel", so maybe just products is what they care about most?
      // Let's do products as it's the most likely "item" count (9.408 items).

      const data = products || [];
      if (data.length === 0)
        return res
          .status(404)
          .json({ error: "Nenhum dado encontrado para exportar." });

      const enrichedData = data.map((p: any) => {
        const promo = p.promotional_price !== undefined && p.promotional_price !== null
          ? p.promotional_price
          : (p.promotionalPrice !== undefined && p.promotionalPrice !== null ? p.promotionalPrice : '');
        return {
          ...p,
          promotional_price: promo,
          PRECO_PROMOCIONAL: promo,
          PROMOTIONAL_PRICE: promo
        };
      });

      const headers = Object.keys(enrichedData[0]);
      const csvRows = [headers.join(",")];

      for (const row of enrichedData) {
        const values = headers.map((header) => {
          const val = row[header] !== undefined && row[header] !== null ? row[header] : "";
          const escaped = ("" + val).replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(values.join(","));
      }

      const csvContent = "\uFEFF" + csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=backup_${tenantId}.csv`,
      );
      return res.send(csvContent);
    } else {
      // Default to SQL
      let sqlContent = `-- Backup for tenant ${tenantId}\n`;
      const tables = [
        { name: "tenants", data: [tenantResult.data] },
        { name: "products", data: products || [] },
        { name: "orders", data: orders || [] },
        { name: "app_reviews", data: reviews || [] },
      ];

      tables.forEach((table) => {
        if (table.data && table.data.length > 0) {
          sqlContent += `-- Table: ${table.name}\n`;
          table.data.forEach((row: any) => {
            if (!row) return;
            const keys = Object.keys(row).join(", ");
            const values = Object.values(row)
              .map((v) => {
                if (v === null) return "NULL";
                if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
                return v;
              })
              .join(", ");
            sqlContent += `INSERT INTO ${table.name} (${keys}) VALUES (${values});\n`;
          });
          sqlContent += "\n";
        }
      });

      res.setHeader("Content-Type", "application/sql");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=backup_${tenantId}.sql`,
      );
      return res.send(sqlContent);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/backups/download-latest/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase.storage
      .from("backups_empresas")
      .download(`${tenantId}/ultimo_backup.json`);

    if (error) return res.status(404).json({ error: "Backup não encontrado." });

    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=backup_empresa_${tenantId}.json`,
    );
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- RESTORE LOGIC ---
const restoreJobs = new Map<
  string,
  {
    status: "pending" | "processing" | "completed" | "failed";
    progress: number;
    message: string;
    details?: any;
  }
>();

app.post("/api/backups/restore/:tenantId", checkTenantAccess, async (req, res) => {
  const tenantId = req.params.tenantId as string;
  const backupData = req.body;

  if (!backupData || (!backupData.data && !backupData.products)) {
    return res.status(400).json({ error: "Formato de backup inválido." });
  }

  const jobId = crypto.randomUUID();
  restoreJobs.set(jobId, {
    status: "pending",
    progress: 0,
    message: "Iniciando restauração...",
  });

  // Start background job
  processRestore(jobId, tenantId, backupData).catch((err) => {
    console.error(`Restore job ${jobId} failed:`, err);
    restoreJobs.set(jobId, {
      status: "failed",
      progress: 0,
      message: err.message,
    });
  });

  res.json({ jobId });
});

app.get("/api/backups/restore-status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = restoreJobs.get(jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });
  res.json(job);
});

async function processRestore(
  jobId: string,
  tenantId: string,
  backupData: any,
) {
  const job = restoreJobs.get(jobId)!;
  job.status = "processing";
  job.progress = 10;
  job.message = "Validando dados do backup...";

  if (backupData.tenantId && backupData.tenantId !== tenantId) {
    throw new Error("O arquivo de backup pertence a outra empresa.");
  }

  if (backupData.version && backupData.version !== "1.0") {
    console.warn(
      `Versão do backup (${backupData.version}) diferente da atual (1.0). Tentando restaurar mesmo assim...`,
    );
  }

  const products =
    backupData.data && backupData.data.products
      ? backupData.data.products
      : backupData.products || [];
  const totalItems = products.length;

  job.progress = 20;
  job.message = `Preparando para restaurar ${totalItems} produtos...`;

  let restoredCount = 0;

  const { data: currentProducts } = await supabase
    .from("products")
    .select("id, barcode, internal_code")
    .eq("tenant_id", tenantId);

  const currentByBarcode = new Map();

  if (currentProducts) {
    for (const p of currentProducts) {
      if (p.barcode) currentByBarcode.set(String(p.barcode).trim(), p.id);
    }
  }

  const CHUNK_SIZE = 100;
  const chunks = [];
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    chunks.push(products.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Deduplicar dentro do próprio chunk pelo EAN para evitar conflitos na mesma transação
    const seenBarcodes = new Set<string>();
    const uniqueChunk = [];

    for (const p of chunk) {
      const barcode = p.barcode ? String(p.barcode).trim() : null;

      if (barcode && seenBarcodes.has(barcode)) continue;
      if (barcode) seenBarcodes.add(barcode);
      uniqueChunk.push(p);
    }

    const upsertPayload = uniqueChunk.map((p: any) => {
      let existingId = null;
      const barcode = p.barcode ? String(p.barcode).trim() : null;
      const internalCode = p.internal_code
        ? String(p.internal_code).trim()
        : p.internalCode
          ? String(p.internalCode).trim()
          : null;

      // Correspondência EXCLUSIVA por EAN (barcode)
      if (barcode && currentByBarcode.has(barcode)) {
        existingId = currentByBarcode.get(barcode);
      }

      // Tratamento estrito de preço promocional
      const rawPromo = p.promotional_price !== undefined && p.promotional_price !== null
        ? p.promotional_price
        : p.promotionalPrice;
      const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
      const validPromo = !isNaN(numPromo) && numPromo > 0 ? numPromo : null;

      // Removemos o ID do backup para evitar colisões entre tenants
      const { id: backupId, updated_at, created_at, ...productPayload } = p;

      const item: any = {
        ...productPayload,
        barcode,
        internal_code: internalCode,
        tenant_id: tenantId,
        promotional_price: validPromo,
      };

      if (existingId) {
        item.id = existingId;
      }

      return item;
    });

    const { error } = await supabase.from("products").upsert(upsertPayload, {
      onConflict: "tenant_id,barcode",
    });
    if (error) {
      console.error("Error upserting chunk:", error);
      throw new Error(`Erro ao restaurar lote de produtos: ${error.message}`);
    }

    restoredCount += chunk.length;
    job.progress = 20 + Math.floor((restoredCount / totalItems) * 70);
    job.message = `Restaurando produtos: ${restoredCount} de ${totalItems}...`;
  }

  let categoriesRestored = 0;
  const importedTenantData =
    backupData.data && backupData.data.tenant
      ? backupData.data.tenant
      : backupData.tenant;

  if (importedTenantData) {
    const tenantData = importedTenantData;

    // Obter o tenant atual para mesclar (evitando duplicar ou excluir)
    const { data: currentTenant } = await supabase
      .from("tenants")
      .select("departments, custom_categories, custom_manufacturers")
      .eq("id", tenantId)
      .single();

    const currentDepts = currentTenant?.departments || [];
    const importedDepts = tenantData.departments || [];

    const mergedDepts = [...currentDepts];
    let nextPriority =
      mergedDepts.length > 0
        ? Math.max(...mergedDepts.map((d: any) => d.priority || 0)) + 1
        : 0;

    for (const impDept of importedDepts) {
      const existingDept = mergedDepts.find(
        (d) => d.name.toLowerCase() === impDept.name.toLowerCase(),
      );
      if (existingDept) {
        // Mescla subcategorias se o departamento já existir
        const mergedCategories = Array.from(
          new Set([
            ...(existingDept.categories || []),
            ...(impDept.categories || []),
          ]),
        );
        existingDept.categories = mergedCategories;
      } else {
        // Cria um novo se não existir
        mergedDepts.push({
          ...impDept,
          id: Math.random().toString(36).substring(7), // novo id para evitar conflitos
          priority: nextPriority++,
        });
      }
    }

    const mergedCategories = Array.from(
      new Set([
        ...(currentTenant?.custom_categories || []),
        ...(tenantData.custom_categories || []),
      ]),
    );
    const mergedManufacturers = Array.from(
      new Set([
        ...(currentTenant?.custom_manufacturers || []),
        ...(tenantData.custom_manufacturers || []),
      ]),
    );

    categoriesRestored = mergedDepts.length;

    const { error } = await supabase
      .from("tenants")
      .update({
        custom_categories: mergedCategories,
        custom_manufacturers: mergedManufacturers,
        departments: mergedDepts,
      })
      .eq("id", tenantId);
    if (error) console.error("Error restoring tenant settings:", error);
  }

  job.status = "completed";
  job.progress = 100;
  job.message = "Restauração concluída com sucesso!";
  job.details = {
    productsRestored: restoredCount,
    categoriesRestored: categoriesRestored,
    pixConfigured: 0,
  };
}

// --- INTEGRATION API (ERP/PDV & INOVAFARMA PORTAL PS) ---

// Middleware para autenticação via Header x-api-key comparando com integration_token salvo no banco
const authenticateIntegration = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const headerApiKey = (req.headers["x-api-key"] as string | undefined)?.trim();
  const bearerHeader = (req.headers["authorization"] as string | undefined)?.trim();
  const queryToken = (req.query?.token as string | undefined)?.trim();

  const rawKey =
    headerApiKey ||
    (bearerHeader?.toLowerCase().startsWith("bearer ")
      ? bearerHeader.slice(7).trim()
      : "") ||
    queryToken ||
    "";

  if (!rawKey) {
    return res
      .status(401)
      .json({ error: "API Key não fornecida no header x-api-key" });
  }

  // Busca o tenant pela integration_token usando supabaseAdmin (ignora bloqueios de RLS)
  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("id, name, integration_token, ignore_erp_prices, erp_url, erp_type")
    .eq("integration_token", rawKey)
    .maybeSingle();

  if (error || !tenant) {
    // Fallback: permite usar o próprio ID do tenant caso configurado como chave em testes
    const { data: tenantById, error: errById } = await supabaseAdmin
      .from("tenants")
      .select("id, name, integration_token, ignore_erp_prices, erp_url, erp_type")
      .eq("id", rawKey)
      .maybeSingle();

    if (errById || !tenantById) {
      return res
        .status(401)
        .json({ error: "API Key inválida (x-api-key não corresponde ao integration_token da farmácia)" });
    }
    (req as any).tenantId = tenantById.id;
    (req as any).tenant = tenantById;
    return next();
  }

  (req as any).tenantId = tenant.id;
  (req as any).tenant = tenant;
  next();
};

/**
 * @swagger
 * /sale:
 *   post:
 *     summary: Webhook de Baixa de Estoque (Venda no Balcão / PDV Inovafarma)
 *     description: Subtrai a quantidade vendida do estoque da loja online. Se o estoque chegar a zero, o produto é ocultado da vitrine principal. Suporta rotas /api/integration/venda e /api/v1/integration/sale.
 *     tags: [Vendas]
 */
app.post(
  [
    "/api/integration/venda",
    "/api/v1/integration/venda",
    "/api/integration/sale",
    "/api/v1/integration/sale",
  ],
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const body = req.body || {};
    const transactionId =
      body.transactionId ??
      body.idTransacao ??
      body.idVenda ??
      body.cupom ??
      body.vendaId;

    // Suporta tanto envio de item único quanto array de itens do cupom PDV (itens / items / produtos)
    const rawItems: any[] = Array.isArray(body.itens)
      ? body.itens
      : Array.isArray(body.items)
        ? body.items
        : Array.isArray(body.produtos)
          ? body.produtos
          : [body];

    try {
      // Mecanismo de Idempotência (Proteção contra envios duplicados do PDV)
      if (transactionId) {
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        const { data: previousLogs, error: checkError } = await supabaseAdmin
          .from("integration_logs")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("endpoint", ["/sale", "/api/integration/venda"])
          .eq("status", "SUCCESS")
          .gte("created_at", yesterday.toISOString())
          .contains("payload", { transactionId });

        if (!checkError && previousLogs && previousLogs.length > 0) {
          return res.status(200).json({
            success: true,
            message:
              "Transação ignorada: transactionId já processado anteriormente.",
            action: "skipped",
          });
        }
      }

      const processedItems: Array<{
        productId: string;
        barcode: string;
        name: string;
        previousStock: number;
        newStock: number;
        hiddenFromShowcase: boolean;
      }> = [];
      const notFoundItems: string[] = [];

      for (const rawItem of rawItems) {
        const rawEan =
          rawItem.ean ??
          rawItem.codigoBarras ??
          rawItem.codBarras ??
          rawItem.codigo_barras ??
          rawItem.barcode ??
          rawItem.gtin;

        const rawInternalCode =
          rawItem.internalCode ??
          rawItem.codigoInterno ??
          rawItem.codigo_interno ??
          rawItem.codigo ??
          rawItem.codProduto ??
          rawItem.sku;

        const rawQty =
          rawItem.quantity ??
          rawItem.quantidade ??
          rawItem.qtd ??
          rawItem.qty ??
          1;

        const rawCurrentStock =
          rawItem.estoqueAtual ??
          rawItem.saldoAtual ??
          rawItem.currentStock ??
          rawItem.novoEstoque;

        const sanitizedEan = sanitizeInovafarmaEan(rawEan);
        const sanitizedInternalCode = rawInternalCode
          ? String(rawInternalCode).trim()
          : "";
        const quantity = parseInovafarmaNumber(rawQty, 0);

        if (!sanitizedEan && !sanitizedInternalCode) {
          return res.status(400).json({
            error:
              "É necessário fornecer o 'ean' (ou 'codigo_barras') ou o 'internalCode' (ou 'codigo_interno') para realizar a baixa de estoque.",
          });
        }

        if (quantity <= 0 && rawCurrentStock === undefined) {
          return res.status(400).json({
            error: "Quantidade inválida. Deve ser um número maior que zero.",
          });
        }

        // Busca o produto no Supabase da respectiva drogaria
        let products: any[] | null = null;

        if (sanitizedEan) {
          const { data: byEan, error: searchErr } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("barcode", sanitizedEan);
          if (searchErr) throw searchErr;
          products = byEan;
        }

        if ((!products || products.length === 0) && sanitizedInternalCode) {
          const { data: byInternal, error: searchIntErr } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("internal_code", sanitizedInternalCode);
          if (searchIntErr) throw searchIntErr;
          products = byInternal;
        }

        if (!products || products.length === 0) {
          notFoundItems.push(sanitizedEan || sanitizedInternalCode);
          continue;
        }

        const product = products[0];
        const previousStock = Number(product.stock || 0);
        const newStock =
          rawCurrentStock !== undefined && rawCurrentStock !== null
            ? Math.max(0, Math.floor(parseInovafarmaNumber(rawCurrentStock, 0)))
            : Math.max(0, previousStock - quantity);

        const updates: any = { stock: newStock };
        if (newStock === 0 && product.is_featured) {
          updates.is_featured = false;
        }

        const { error: updateError } = await supabaseAdmin
          .from("products")
          .update(updates)
          .eq("id", product.id)
          .eq("tenant_id", tenantId);

        if (updateError) throw updateError;

        processedItems.push({
          productId: product.id,
          barcode: product.barcode || sanitizedEan,
          name: product.name,
          previousStock,
          newStock,
          hiddenFromShowcase: newStock === 0,
        });
      }

      if (processedItems.length === 0 && notFoundItems.length > 0) {
        await logIntegration(
          tenantId,
          "/api/integration/venda",
          req.body,
          "FAILED",
          `Produto(s) não encontrado(s) no catálogo: ${notFoundItems.join(", ")}`,
        );
        return res.status(404).json({
          error: "Produto não encontrado no catálogo da drogaria.",
          notFound: notFoundItems,
        });
      }

      await logIntegration(
        tenantId,
        "/api/integration/venda",
        req.body,
        "SUCCESS",
      );

      const first = processedItems[0];
      res.status(200).json({
        success: true,
        newStock: first?.newStock ?? 0,
        hiddenFromShowcase: first?.hiddenFromShowcase ?? false,
        processedCount: processedItems.length,
        items: processedItems,
        notFound: notFoundItems.length > 0 ? notFoundItems : undefined,
      });
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/api/integration/venda",
        req.body,
        "FAILED",
        error.message,
      );
      res.status(500).json({
        error: "Erro interno no servidor de integração.",
        details: error.message,
      });
    }
  },
);

/**
 * @swagger
 * /purchase:
 *   post:
 *     summary: Sincronização de Entrada de Mercadoria (Notas Fiscais / Compra PDV Inovafarma)
 *     description: Soma a quantidade de entrada ao saldo atual (ou define saldo exato). Atualiza preços se necessário. Cria rascunho se o produto for novo. Suporta rotas /api/integration/compra e /api/v1/integration/purchase.
 *     tags: [Compras]
 */
app.post(
  [
    "/api/integration/compra",
    "/api/v1/integration/compra",
    "/api/integration/purchase",
    "/api/v1/integration/purchase",
  ],
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const tenantObj = (req as any).tenant || {};
    const ignoreErpPrices = Boolean(tenantObj.ignore_erp_prices);
    const body = req.body || {};

    const rawItems: any[] = Array.isArray(body.itens)
      ? body.itens
      : Array.isArray(body.items)
        ? body.items
        : Array.isArray(body.produtos)
          ? body.produtos
          : [body];

    try {
      const results: any[] = [];

      for (const rawItem of rawItems) {
        const rawEan =
          rawItem.ean ??
          rawItem.codigoBarras ??
          rawItem.codBarras ??
          rawItem.codigo_barras ??
          rawItem.barcode ??
          rawItem.gtin;

        const rawInternalCode =
          rawItem.internalCode ??
          rawItem.codigoInterno ??
          rawItem.codigo_interno ??
          rawItem.codigo ??
          rawItem.codProduto ??
          rawItem.sku;

        const rawName =
          rawItem.name ??
          rawItem.nome ??
          rawItem.descricao ??
          rawItem.produto ??
          rawItem.nomeProduto;

        const rawQty =
          rawItem.quantity ??
          rawItem.quantidade ??
          rawItem.qtd ??
          rawItem.qty;

        const rawSetStock =
          rawItem.estoqueAtual ??
          rawItem.saldoAtual ??
          rawItem.estoque ??
          rawItem.setStock;

        const rawCostPrice =
          rawItem.costPrice ??
          rawItem.precoCusto ??
          rawItem.preco_custo ??
          rawItem.valorCusto ??
          rawItem.custo;

        const rawSalePrice =
          rawItem.salePrice ??
          rawItem.precoVenda ??
          rawItem.preco_venda ??
          rawItem.valorVenda ??
          rawItem.preco ??
          rawItem.price;

        const rawOriginalPrice =
          rawItem.originalPrice ??
          rawItem.original_price ??
          rawItem.precoOriginal ??
          rawItem.preco_original ??
          rawItem.pmc ??
          rawItem.PMC ??
          rawItem.preco_pmc ??
          rawItem.preco_tabela ??
          rawItem.valor_original;

        const sanitizedEan = sanitizeInovafarmaEan(rawEan);
        const sanitizedInternalCode = rawInternalCode
          ? String(rawInternalCode).trim()
          : "";

        if (!sanitizedEan && !sanitizedInternalCode) {
          return res.status(400).json({
            error:
              "O 'ean' (ou 'codigo_barras') é obrigatório para entrada de mercadoria.",
          });
        }

        const quantity = parseInovafarmaNumber(rawQty, 0);
        const exactStock =
          rawSetStock !== undefined && rawSetStock !== null
            ? Math.max(0, Math.floor(parseInovafarmaNumber(rawSetStock, 0)))
            : undefined;

        if (quantity <= 0 && exactStock === undefined) {
          return res.status(400).json({
            error: "Quantidade inválida. Deve ser um número maior que zero.",
          });
        }

        const parsedCost = parseInovafarmaNumber(rawCostPrice, -1);
        const sanitizedCostPrice =
          parsedCost >= 0 ? Math.round(parsedCost * 100) / 100 : undefined;

        const parsedSale = parseInovafarmaNumber(rawSalePrice, -1);
        const parsedOriginal = parseInovafarmaNumber(rawOriginalPrice, -1);
        // Fallback inteligente: se preco_venda for nulo, indefinido ou <= 0, assume preco_original (PMC)
        let sanitizedSalePrice =
          parsedSale > 0
            ? Math.round(parsedSale * 100) / 100
            : parsedOriginal > 0
              ? Math.round(parsedOriginal * 100) / 100
              : undefined;

        let products: any[] | null = null;
        if (sanitizedEan) {
          const { data: byEan, error: searchErr } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("barcode", sanitizedEan);
          if (searchErr) throw searchErr;
          products = byEan;
        }

        if ((!products || products.length === 0) && sanitizedInternalCode) {
          const { data: byInternal, error: searchIntErr } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("internal_code", sanitizedInternalCode);
          if (searchIntErr) throw searchIntErr;
          products = byInternal;
        }

        if (products && products.length > 0) {
          const product = products[0];
          const newStock =
            exactStock !== undefined
              ? exactStock
              : Number(product.stock || 0) + quantity;

          const updates: any = { stock: newStock };
          if (
            !ignoreErpPrices &&
            sanitizedSalePrice !== undefined &&
            sanitizedSalePrice > 0 &&
            sanitizedSalePrice !== product.price
          ) {
            updates.price = sanitizedSalePrice;
          }

          const { error: updateError } = await supabaseAdmin
            .from("products")
            .update(updates)
            .eq("id", product.id)
            .eq("tenant_id", tenantId);

          if (updateError) throw updateError;
          results.push({
            action: "updated",
            productId: product.id,
            barcode: product.barcode,
            newStock,
          });
        } else {
          if (
            sanitizedSalePrice === undefined &&
            sanitizedCostPrice !== undefined
          ) {
            sanitizedSalePrice =
              Math.round(sanitizedCostPrice * 1.5 * 100) / 100;
          }

          const finalBarcode = sanitizedEan || sanitizedInternalCode;
          const newProduct = {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            barcode: finalBarcode,
            internal_code: sanitizedInternalCode || finalBarcode,
            name: rawName
              ? String(rawName).trim()
              : `Produto Novo (${finalBarcode})`,
            stock: exactStock !== undefined ? exactStock : quantity,
            price: sanitizedSalePrice ?? 0,
            category: "Geral",
            is_ai_enriched: false,
            is_featured: false,
          };

          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("products")
            .insert(newProduct)
            .select();

          if (insertError) throw insertError;
          results.push({
            action: "created",
            product: inserted?.[0] || newProduct,
            newStock: newProduct.stock,
          });
        }
      }

      await logIntegration(
        tenantId,
        "/api/integration/compra",
        req.body,
        "SUCCESS",
      );

      const first = results[0];
      const statusCode =
        results.length === 1 && first?.action === "created" ? 201 : 200;
      res.status(statusCode).json({
        success: true,
        action: first?.action || "updated",
        newStock: first?.newStock,
        product: first?.product,
        processedCount: results.length,
        results,
      });
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/api/integration/compra",
        req.body,
        "FAILED",
        error.message,
      );
      res.status(500).json({
        error: "Erro interno no processamento da entrada de mercadoria.",
        details: error.message,
      });
    }
  },
);

/**
 * Rota de autenticação dinâmica no Inovafarma (`POST /api/login`) por `tenant_id`:
 * Busca dinamicamente o login e a senha salvos no cadastro da farmácia no Supabase
 * para gerar e armazenar o `accessToken` com validade de 30 dias (`erp_access_token` / `erp_token_expiration`).
 */
app.post(
  [
    "/api/integration/inovafarma/login",
    "/api/v1/integration/inovafarma/login",
  ],
  async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = (body.tenantId || body.tenant_id || "").toString().trim();
      if (!tenantId) {
        return res.status(400).json({
          error: "O identificador da farmácia (tenantId) é obrigatório para autenticar no Inovafarma.",
        });
      }

      const authResult = await authenticateInovafarma({
        supabaseClient: supabaseAdmin,
        tenantId,
        baseUrl: body.erpBaseUrl || body.erp_base_url || body.erpUrl || body.erp_url || undefined,
        cnpj: body.erpCnpj || body.erp_cnpj || body.cnpj || undefined,
        login: body.login || body.apiLogin || body.erpLogin || body.erp_login || body.erpApiLogin || undefined,
        password: body.password || body.senha || body.apiPassword || body.erpPassword || body.erp_password || body.erpApiPassword || undefined,
        apiKey: body.apiKey || body.erpApiKey || body.erp_api_key || undefined,
        forceRefresh: body.forceRefresh !== undefined ? Boolean(body.forceRefresh) : true,
      });

      return res.status(200).json({
        success: true,
        accessToken: authResult.accessToken,
        expiresAt: authResult.expiresAt,
        endpointUsed: authResult.endpointUsed,
        reusedCachedToken: authResult.reusedCachedToken,
      });
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        error: err?.message || "Falha ao autenticar na API do Inovafarma (POST /api/login).",
      });
    }
  },
);

/**
 * Rota de teste de conectividade com o banco do ERP Inovafarma (`GET /api/v1/{integracao}/server`)
 */
app.all(
  [
    "/api/integration/inovafarma/server",
    "/api/v1/integration/inovafarma/server",
  ],
  async (req, res) => {
    try {
      const body = req.body || {};
      const query = req.query || {};
      const tenantId = (body.tenantId || body.tenant_id || query.tenantId || query.tenant_id || "").toString().trim();

      let baseUrl = (body.erpBaseUrl || body.erp_base_url || body.erpUrl || query.erpUrl || "").toString().trim();
      let routeId = (body.erpRouteId || body.erp_route_id || query.routeId || "").toString().trim();
      let cnpj = sanitizeCnpj(body.erpCnpj || body.erp_cnpj || body.cnpj || query.cnpj || req.headers["cnpj"] || "");
      let apiKey = (body.apiKey || body.erpApiKey || body.erp_api_key || query.apiKey || "").toString().trim();
      const apiLogin = (body.apiLogin || body.erpLogin || body.erp_login || body.erpApiLogin || "").toString().trim();
      const rawApiPassword = (body.apiPassword || body.erpPassword || body.erp_password || body.erpApiPassword || "").toString().trim();
      const apiPassword = rawApiPassword && !isMaskedErpPassword(rawApiPassword) ? rawApiPassword : "";
      let token =
        (body.apiToken || body.token || (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") || "").toString().trim();

      const parsedServerErp = parseInovafarmaUrlAndRoute(baseUrl, routeId);
      baseUrl = parsedServerErp.origin;
      routeId = parsedServerErp.slug;
      cnpj = resolveEffectiveInovafarmaCnpj(cnpj, routeId);

      if (tenantId) {
        if (baseUrl || routeId || cnpj || apiKey || apiLogin || apiPassword) {
          await saveTenantInovafarmaState(supabaseAdmin, tenantId, {
            erpBaseUrl: baseUrl || undefined,
            erpRouteId: routeId || undefined,
            erpCnpj: cnpj || undefined,
            erpApiKey: apiKey || undefined,
            erpLogin: apiLogin || undefined,
            erpPassword: apiPassword || undefined,
          });
        }

        const resolved = await resolveTenantInovafarmaToken({
          supabaseClient: supabaseAdmin,
          tenantId,
          baseUrlOverride: baseUrl || undefined,
          routeIdOverride: routeId || undefined,
          cnpjOverride: cnpj || undefined,
          tokenOverride: token || undefined,
          loginOverride: apiLogin || undefined,
          passwordOverride: apiPassword || undefined,
          apiKeyOverride: apiKey || undefined,
        });
        token = resolved.token;
        baseUrl = resolved.baseUrl;
        routeId = resolved.routeId;
        cnpj = resolveEffectiveInovafarmaCnpj(resolved.cnpj, routeId);
        apiKey = resolved.apiKey;
      }

      const connectivity = await checkInovafarmaServerConnectivity({
        baseUrl: baseUrl || INOVAFARMA_DEFAULT_API_URL,
        routeId: routeId || INOVAFARMA_DEFAULT_ROUTE_ID,
        token,
        cnpj,
        apiKey: apiKey || undefined,
        tenantId: tenantId || undefined,
        supabaseClient: supabaseAdmin,
      });

      await logIntegration(
        tenantId || "homologacao",
        connectivity.endpointUsed,
        {
          routeId: routeId || INOVAFARMA_DEFAULT_ROUTE_ID,
          cnpj: connectivity.cnpjSent || cnpj,
          httpStatus: connectivity.httpStatus ?? connectivity.status,
          serversCount: connectivity.servers?.length ?? connectivity.serverInfo?.length ?? 0,
        },
        "SUCCESS",
      );

      return res.status(200).json(connectivity);
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        connected: false,
        error: err?.message || "Falha ao testar conectividade com o servidor Inovafarma (/server).",
      });
    }
  },
);

/**
 * Rota oficial para sincronização manual ou agendada com o ERP Inovafarma (Portal PS)
 */
app.post(
  [
    "/api/integration/inovafarma/sync",
    "/api/v1/integration/inovafarma/sync",
  ],
  async (req, res) => {
    try {
      const body = req.body || {};
      const headerKey = (req.headers["x-api-key"] as string | undefined)?.trim();
      let tenantId = (body.tenantId || body.tenant_id || "").toString().trim();
      const erpUrl = (
        body.erpBaseUrl ||
        body.erp_base_url ||
        body.erpUrl ||
        body.erp_url ||
        ""
      )
        .toString()
        .trim();
      const erpRouteId = (
        body.erpRouteId ||
        body.erp_route_id ||
        body.routeId ||
        ""
      )
        .toString()
        .trim();
      const cnpj = sanitizeCnpj(
        body.erpCnpj || body.erp_cnpj || body.cnpj || req.headers["cnpj"] || "",
      );
      const apiKey = (
        body.apiKey ||
        body.erpApiKey ||
        body.erp_api_key ||
        ""
      )
        .toString()
        .trim();
      const apiLogin = (
        body.apiLogin ||
        body.erpLogin ||
        body.erp_login ||
        body.erpApiLogin ||
        body.erp_api_login ||
        ""
      )
        .toString()
        .trim();
      const rawApiPassword = (
        body.apiPassword ||
        body.erpPassword ||
        body.erp_password ||
        body.erpApiPassword ||
        body.erp_api_password ||
        ""
      )
        .toString()
        .trim();
      const apiPassword =
        rawApiPassword && !isMaskedErpPassword(rawApiPassword) ? rawApiPassword : "";

      const apiToken = (
        body.apiToken ||
        body.integrationToken ||
        body.token ||
        headerKey ||
        ""
      )
        .toString()
        .trim();

      // Caso tenantId não venha no body, tenta localizar pelo x-api-key
      if (!tenantId && apiToken) {
        const { data: tenantByToken } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("integration_token", apiToken)
          .maybeSingle();
        if (tenantByToken?.id) {
          tenantId = tenantByToken.id;
        }
      }

      if (!tenantId) {
        return res.status(400).json({
          error: "O identificador da farmácia (tenantId) é obrigatório para sincronizar com o Inovafarma.",
        });
      }

      const parsedSyncErp = parseInovafarmaUrlAndRoute(erpUrl, erpRouteId);
      const effectiveSyncCnpj = resolveEffectiveInovafarmaCnpj(
        cnpj,
        parsedSyncErp.slug,
      );
      const requestedOffset =
        body.offset !== undefined && Number(body.offset) >= 1
          ? Math.floor(Number(body.offset))
          : 1;
      const requestedLimit =
        body.limit !== undefined && Number(body.limit) >= 1
          ? Math.min(500, Math.floor(Number(body.limit)))
          : 500;
      const requestedMaxPages =
        body.maxPages !== undefined && Number(body.maxPages) >= 1
          ? Math.min(3, Math.floor(Number(body.maxPages)))
          : 3;

      // Persiste configurações da farmácia apenas no lote inicial (offset = 1) para manter os lotes seguintes ultra-rápidos
      if (requestedOffset <= 1) {
        await saveTenantInovafarmaState(supabaseAdmin, tenantId, {
          erp_base_url: erpUrl ? parsedSyncErp.origin : undefined,
          erp_route_id: erpRouteId || erpUrl ? parsedSyncErp.slug : undefined,
          erp_cnpj: effectiveSyncCnpj || undefined,
          erp_login: apiLogin || undefined,
          erp_password_plain: apiPassword || undefined,
          erp_api_key: apiKey || undefined,
        });

        const tenantUpdates: Record<string, any> = { erp_type: "inovafarma" };
        if (erpUrl) tenantUpdates.erp_url = parsedSyncErp.origin;
        if (apiToken) tenantUpdates.integration_token = apiToken;
        if (typeof body.ignoreErpPrices === "boolean") {
          tenantUpdates.ignore_erp_prices = body.ignoreErpPrices;
        }

        await supabaseAdmin
          .from("tenants")
          .update(tenantUpdates)
          .eq("id", tenantId);
      }

      const syncResult = await syncInovafarmaProductsToSupabase(
        supabaseAdmin,
        {
          tenantId,
          erpUrl: parsedSyncErp.origin || undefined,
          erpRouteId: parsedSyncErp.slug || undefined,
          apiToken: apiToken || undefined,
          apiLogin: apiLogin || undefined,
          apiPassword: apiPassword || undefined,
          apiKey: apiKey || undefined,
          cnpj: effectiveSyncCnpj || undefined,
          mode: body.mode === "delta" ? "delta" : "full",
          inicial: body.inicial ? String(body.inicial).trim() : undefined,
          final: body.final ? String(body.final).trim() : undefined,
          offset: requestedOffset,
          limit: requestedLimit,
          maxPages: requestedMaxPages,
          cumulativeReceived:
            body.cumulativeReceived !== undefined
              ? Number(body.cumulativeReceived)
              : undefined,
          cumulativeCreated:
            body.cumulativeCreated !== undefined
              ? Number(body.cumulativeCreated)
              : undefined,
          cumulativeUpdated:
            body.cumulativeUpdated !== undefined
              ? Number(body.cumulativeUpdated)
              : undefined,
          cumulativeSkipped:
            body.cumulativeSkipped !== undefined
              ? Number(body.cumulativeSkipped)
              : undefined,
          ignoreErpPrices:
            typeof body.ignoreErpPrices === "boolean"
              ? body.ignoreErpPrices
              : undefined,
          productsOverride: Array.isArray(body.products)
            ? body.products
            : Array.isArray(body.produtos)
              ? body.produtos
              : undefined,
        },
        (name, category) => {
          try {
            const strictClassified = classifyProductCategory(name, undefined, category || "");
            return {
              department: strictClassified.department,
              category: strictClassified.subcategory,
              subcategory: strictClassified.subcategory,
            };
          } catch {
            return {
              department: "Medicamentos",
              category: "Outros Medicamentos",
              subcategory: "Outros Medicamentos",
            };
          }
        },
      );

      // Busca logs recentes apenas quando finalizar a sincronização (ou lote único) para não atrasar os lotes intermediários
      let recentLogs: any[] = [];
      if (!syncResult.partial) {
        const { data } = await supabaseAdmin
          .from("integration_logs")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(20);
        recentLogs = data || [];
      }

      return res.status(200).json({
        ...syncResult,
        success: true,
        partial: Boolean(syncResult.partial),
        nextOffset: syncResult.partial ? syncResult.nextOffset ?? null : null,
        receivedCount: syncResult.receivedCount ?? syncResult.totalFetched ?? 0,
        createdCount: syncResult.createdCount ?? syncResult.insertedCount ?? 0,
        updatedCount: syncResult.updatedCount ?? 0,
        logs: recentLogs,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Erro ao sincronizar catálogo com a API do Inovafarma.",
      });
    }
  },
);

/**
 * Rota de conciliação de vendas enviadas ao Inovafarma (`GET /api/v1/{integracao}/vendaporid/{codigoVendaOnLine}`)
 */
app.post(
  [
    "/api/integration/inovafarma/reconcile",
    "/api/v1/integration/inovafarma/reconcile",
  ],
  async (req, res) => {
    try {
      const body =
        typeof req.body === "string"
          ? { tenantId: req.body }
          : req.body || {};
      const tenantId = (
        body.tenantId ||
        body.tenant_id ||
        req.query?.tenantId ||
        req.query?.tenant_id ||
        ""
      )
        .toString()
        .trim();

      if (!tenantId) {
        const msg =
          "O identificador da farmácia (tenantId) é obrigatório para conciliar vendas no Inovafarma.";
        return res.status(400).json({
          success: false,
          error: msg,
          details: msg,
        });
      }

      const result = await reconcilePendingInovafarmaOrders(supabaseAdmin, {
        tenantId,
        orderId: body.orderId || body.order_id || undefined,
        orderIds: Array.isArray(body.orderIds) ? body.orderIds : undefined,
        codigoVendaOnLine: body.codigoVendaOnLine || body.codigo_venda_online || undefined,
        baseUrl: body.erpBaseUrl || body.erpUrl || undefined,
        routeId: body.erpRouteId || body.routeId || undefined,
        cnpj: body.erpCnpj || body.cnpj || undefined,
        apiKey: body.apiKey || body.erpApiKey || undefined,
      });

      const { data: recentLogs } = await supabaseAdmin
        .from("integration_logs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20);

      return res.status(200).json({
        ...result,
        logs: recentLogs || [],
      });
    } catch (error: any) {
      const errDetail = String(
        error?.message || "Erro ao conciliar vendas no Inovafarma (/vendaporid).",
      ).slice(0, 2000);
      return res.status(400).json({
        success: false,
        error: errDetail,
        details: errDetail,
      });
    }
  },
);

/**
 * Consulta direta de venda por ID online (`GET /api/integration/inovafarma/vendaporid/:codigoVendaOnLine`)
 */
app.get(
  [
    "/api/integration/inovafarma/vendaporid/:codigoVendaOnLine",
    "/api/v1/integration/inovafarma/vendaporid/:codigoVendaOnLine",
  ],
  async (req, res) => {
    try {
      const codigoVendaOnLine = String(req.params.codigoVendaOnLine || "").trim();
      const tenantId = (req.query.tenantId || req.query.tenant_id || "").toString().trim();
      let token =
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "").trim() ||
        (req.query.token as string | undefined)?.trim() ||
        "";
      let cnpj = sanitizeCnpj(req.headers["cnpj"] || req.query.cnpj || "");
      let baseUrl = (req.query.erpUrl || "").toString().trim();
      let routeId = (req.query.routeId || "").toString().trim();
      let apiKey = (req.query.apiKey || "").toString().trim();

      if (tenantId) {
        const resolved = await resolveTenantInovafarmaToken({
          supabaseClient: supabaseAdmin,
          tenantId,
          baseUrlOverride: baseUrl || undefined,
          routeIdOverride: routeId || undefined,
          cnpjOverride: cnpj || undefined,
          tokenOverride: token || undefined,
          apiKeyOverride: apiKey || undefined,
        });
        token = resolved.token;
        cnpj = resolved.cnpj;
        baseUrl = resolved.baseUrl;
        routeId = resolved.routeId;
        apiKey = resolved.apiKey;
      }

      const result = await fetchInovafarmaVendaPorId({
        baseUrl: baseUrl || INOVAFARMA_DEFAULT_API_URL,
        routeId: routeId || INOVAFARMA_DEFAULT_ROUTE_ID,
        token,
        cnpj,
        apiKey: apiKey || undefined,
        codigoVendaOnLine,
        tenantId: tenantId || undefined,
        supabaseClient: supabaseAdmin,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error?.message || "Erro ao consultar venda por ID no Inovafarma.",
      });
    }
  },
);

/**
 * Rotas auxiliares oficiais do Inovafarma (Portal PS):
 * - GET /api/integration/inovafarma/produtos (offset>=1, limit<=500)
 * - GET /api/integration/inovafarma/produtosalterados (inicial, final AAAA-MM-DD máx 31 dias, offset>=1, limit<=500)
 * - GET /api/integration/inovafarma/clientes (offset>=1, limit<=500)
 * - GET /api/integration/inovafarma/clientesalterados (inicial, final AAAA-MM-DD máx 31 dias, offset>=1, limit<=500)
 * - GET /api/integration/inovafarma/funcionarios (offset>=1, limit<=500)
 * - GET /api/integration/inovafarma/metodospagamentos
 */
app.get(
  [
    "/api/integration/inovafarma/produtos",
    "/api/v1/integration/inovafarma/produtos",
    "/api/integration/inovafarma/produtosalterados",
    "/api/v1/integration/inovafarma/produtosalterados",
    "/api/integration/inovafarma/clientes",
    "/api/v1/integration/inovafarma/clientes",
    "/api/integration/inovafarma/clientesalterados",
    "/api/v1/integration/inovafarma/clientesalterados",
    "/api/integration/inovafarma/funcionarios",
    "/api/v1/integration/inovafarma/funcionarios",
    "/api/integration/inovafarma/metodospagamentos",
    "/api/v1/integration/inovafarma/metodospagamentos",
  ],
  async (req, res) => {
    try {
      const tenantId = (req.query.tenantId || req.query.tenant_id || "").toString().trim();
      let token =
        (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "").trim() ||
        (req.headers["x-api-key"] as string | undefined)?.trim() ||
        (req.query.token as string | undefined)?.trim() ||
        "";
      let cnpj = sanitizeCnpj(req.headers["cnpj"] || req.query.cnpj || "");
      let baseUrl = (req.query.erpUrl || "").toString().trim();
      let routeId = (req.query.routeId || "").toString().trim();
      let apiKey = (req.query.apiKey || "").toString().trim();

      if (tenantId) {
        const resolvedAuth = await resolveTenantInovafarmaToken({
          supabaseClient: supabaseAdmin,
          tenantId,
          baseUrlOverride: baseUrl || undefined,
          routeIdOverride: routeId || undefined,
          cnpjOverride: cnpj || undefined,
          tokenOverride: token || undefined,
          apiKeyOverride: apiKey || undefined,
        });
        token = resolvedAuth.token;
        cnpj = resolvedAuth.cnpj;
        baseUrl = resolvedAuth.baseUrl;
        routeId = resolvedAuth.routeId;
        apiKey = resolvedAuth.apiKey;
      }

      const offset = req.query.offset ? Number(req.query.offset) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 500;
      const inicial = (req.query.inicial || "").toString().trim();
      const final = (req.query.final || "").toString().trim();
      const pathLower = req.path.toLowerCase();

      if (pathLower.endsWith("/metodospagamentos")) {
        const result = await fetchInovafarmaMetodosPagamentos({
          baseUrl,
          routeId,
          token,
          cnpj,
          apiKey: apiKey || undefined,
          tenantId: tenantId || undefined,
          supabaseClient: supabaseAdmin,
        });
        return res.json({ success: true, ...result });
      }

      if (pathLower.endsWith("/produtosalterados")) {
        const result = await fetchInovafarmaProdutosAlterados({
          baseUrl,
          routeId,
          token,
          cnpj,
          apiKey: apiKey || undefined,
          inicial,
          final,
          offset,
          limit,
          fetchAllPages: false,
          tenantId: tenantId || undefined,
          supabaseClient: supabaseAdmin,
        });
        return res.json({ success: true, ...result });
      }

      if (pathLower.endsWith("/clientesalterados")) {
        const result = await fetchInovafarmaClientesAlterados({
          baseUrl,
          routeId,
          token,
          cnpj,
          apiKey: apiKey || undefined,
          inicial,
          final,
          offset,
          limit,
          tenantId: tenantId || undefined,
          supabaseClient: supabaseAdmin,
        });
        return res.json({ success: true, ...result });
      }

      if (pathLower.endsWith("/clientes")) {
        const result = await fetchInovafarmaClientes({
          baseUrl,
          routeId,
          token,
          cnpj,
          apiKey: apiKey || undefined,
          offset,
          limit,
          tenantId: tenantId || undefined,
          supabaseClient: supabaseAdmin,
        });
        return res.json({ success: true, ...result });
      }

      if (pathLower.endsWith("/funcionarios")) {
        const result = await fetchInovafarmaFuncionarios({
          baseUrl,
          routeId,
          token,
          cnpj,
          apiKey: apiKey || undefined,
          offset,
          limit,
          tenantId: tenantId || undefined,
          supabaseClient: supabaseAdmin,
        });
        return res.json({ success: true, ...result });
      }

      const result = await fetchInovafarmaProducts({
        baseUrl,
        routeId,
        token,
        cnpj,
        apiKey: apiKey || undefined,
        offset,
        limit,
        fetchAllPages: false,
        tenantId: tenantId || undefined,
        supabaseClient: supabaseAdmin,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: err?.message || "Erro na consulta à API do Inovafarma.",
      });
    }
  },
);

app.get(
  [
    "/api/integration/logs/:tenantId",
    "/api/v1/integration/logs/:tenantId",
  ],
  checkTenantAccess,
  async (req, res) => {
    try {
      const { tenantId } = req.params;
      const { data, error } = await supabaseAdmin
        .from("integration_logs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        const errMsg = error.message || String(error);
        const errStr = JSON.stringify(error);
        if (
          errMsg.includes("schema cache") ||
          errStr.includes("schema cache") ||
          error.code === "42P01"
        ) {
          return res.json([]);
        }
        return res.status(500).json({ error: errMsg });
      }
      res.json(data || []);
    } catch (err: any) {
      const errMsg = err?.message || err?.error || String(err);
      const errStr = JSON.stringify(err);
      if (
        errMsg.includes("schema cache") ||
        errStr.includes("schema cache") ||
        err?.code === "42P01"
      ) {
        return res.json([]);
      }
      res.status(500).json({ error: errMsg });
    }
  },
);

/**
 * Envio de Pedido de Venda ao PDV / ERP Inovafarma (`POST /api/v1/{integracao}/Venda`):
 * - Checklist de Conectividade (`GET /server`) e Deduplicação (`GET /vendaporid/{codigoVendaOnLine}`).
 * - `vendedor`: apenas CPF ou CODIGOFUNCIONARIO mapeado de `/funcionarios` (nunca nome).
 * - Descontos distribuídos em `descontoUnitario` (`< valorUnitario`).
 * - Fechamento Financeiro Exato (Centavo por Centavo): `total = Σ (quantidade * (valorUnitario - descontoUnitario)) + entrega.taxa`.
 * - PIX classificado como Cartão (`tipo: "C"`, `formaPagamento: "PIX"` / `"3"`).
 * - Validação de endereço obrigatório (`endereco`, `cep`, `cidade`) quando `retirarNaLoja: false`.
 */
app.post(
  [
    "/api/integrations/erp/send-order",
    "/api/integration/inovafarma/venda",
    "/api/v1/integration/inovafarma/venda",
  ],
  async (req, res) => {
    try {
      const body = req.body || {};
      const order_id = body.order_id || body.orderId || body.pedidoId;
      const tenant_id = body.tenant_id || body.tenantId;

      if (!tenant_id) {
        return res.status(400).json({ error: "O 'tenant_id' da farmácia é obrigatório." });
      }

      // 1. Busca configurações da farmácia no Supabase
      const { data: tenantSettings } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", tenant_id)
        .maybeSingle();

      const erpConfig = extractTenantErpConfig(tenantSettings || {});
      const rawConfiguredLogin = String(
        body.erpLogin ||
          tenantSettings?.erp_api_login ||
          tenantSettings?.smart_banners?._erpCredentials?.erp_login ||
          erpConfig.erpLogin ||
          "",
      ).trim();
      const rawConfiguredPassword = String(
        body.erpPassword ||
          tenantSettings?.erp_api_password ||
          tenantSettings?.smart_banners?._erpCredentials?.erp_password ||
          erpConfig.erp_password ||
          "",
      ).trim();
      let effectiveErpCnpj = sanitizeCnpj(
        body.cnpj || erpConfig.erpCnpj || tenantSettings?.cnpj || "",
      );

      // Identifica se a loja possui credenciais REAIS e completas do Portal PS (não homologação padrão)
      const isHomologationPlaceholder =
        !rawConfiguredLogin ||
        !rawConfiguredPassword ||
        rawConfiguredLogin.toLowerCase() === "homologacao@inovafarma.com.br" ||
        effectiveErpCnpj === "02433981097173";

      const isMacabuStore =
        /macabu/i.test(String(tenantSettings?.slug || "")) ||
        /macabu/i.test(String(tenantSettings?.name || ""));

      const canAttemptPortalPsWebApi = Boolean(
        !isMacabuStore &&
          !isHomologationPlaceholder &&
          rawConfiguredLogin &&
          rawConfiguredPassword &&
          effectiveErpCnpj &&
          body.forcePortalPs === true,
      );

      let effectiveErpToken = "";
      let effectiveErpBaseUrl =
        body.erpBaseUrl || body.erpUrl || erpConfig.erpBaseUrl || INOVAFARMA_DEFAULT_API_URL;
      let effectiveErpRouteId =
        body.erpRouteId || body.routeId || erpConfig.erpRouteId || INOVAFARMA_DEFAULT_ROUTE_ID;
      let effectiveErpApiKey =
        body.apiKey || body.erpApiKey || erpConfig.erpApiKey || "";

      if (canAttemptPortalPsWebApi && tenantSettings) {
        try {
          const resolvedAuth = await resolveTenantInovafarmaToken({
            supabaseClient: supabaseAdmin,
            tenantId: tenant_id,
            baseUrlOverride: effectiveErpBaseUrl,
            routeIdOverride: effectiveErpRouteId,
            cnpjOverride: effectiveErpCnpj,
            apiKeyOverride: effectiveErpApiKey,
          });
          effectiveErpToken = resolvedAuth.token;
          effectiveErpCnpj = resolvedAuth.cnpj;
          effectiveErpBaseUrl = resolvedAuth.baseUrl;
          effectiveErpRouteId = resolvedAuth.routeId;
          effectiveErpApiKey = resolvedAuth.apiKey;
        } catch (authErr: any) {
          console.warn(
            "[Inovafarma Venda] Sem autenticação web Portal PS, utilizando fila do Agente Local (pending_erp):",
            authErr?.message,
          );
        }
      }

      if (!order_id) {
        return res.status(400).json({ error: "Missing order_id or tenant_id" });
      }

      const { data: order, error: fetchError } = await supabaseAdmin
        .from("orders")
        .select(`
          *,
          order_items (
            quantity,
            unit_price,
            products (
              name,
              barcode,
              internal_code
            )
          ),
          customers (
            name,
            phone,
            cpf,
            address,
            address_number,
            neighborhood,
            city,
            cep
          )
        `)
        .eq("id", order_id)
        .eq("tenant_id", tenant_id)
        .maybeSingle();

      let targetOrder: any = order;

      if (fetchError || !order) {
        const { data: orderJson, error: fetchJsonError } = await supabaseAdmin
          .from("orders")
          .select("*")
          .eq("id", order_id)
          .eq("tenant_id", tenant_id)
          .maybeSingle();

        if (fetchJsonError || !orderJson) {
          return res.status(404).json({
            error: "Pedido não encontrado ou acesso negado ao tenant.",
          });
        }
        targetOrder = orderJson;
      }

      const customer = targetOrder.customers || targetOrder.customer || {};
      const items = targetOrder.order_items || targetOrder.items || [];

      // Enriquecimento dos itens com internal_code e barcode reais do banco products do tenant
      const itemProductIds = items
        .map((it: any) => it.id || it.product_id || it.productId)
        .filter((id: any) => typeof id === "string" && id.trim().length > 0);
      const productLookupById = new Map<string, any>();
      const productLookupByBarcode = new Map<string, any>();

      if (itemProductIds.length > 0) {
        try {
          const { data: dbProds } = await supabaseAdmin
            .from("products")
            .select("id, name, barcode, internal_code, price, original_price")
            .eq("tenant_id", tenant_id)
            .in("id", itemProductIds);
          if (Array.isArray(dbProds)) {
            for (const p of dbProds) {
              if (p.id) productLookupById.set(String(p.id), p);
              if (p.barcode) productLookupByBarcode.set(String(p.barcode).trim(), p);
            }
          }
        } catch (e) {}
      }

      const rawItemsForVenda = items.map((item: any, idx: number) => {
        const dbProd =
          productLookupById.get(String(item.id || item.product_id || item.productId || "")) ||
          productLookupByBarcode.get(String(item.barcode || item.ean || "").trim()) ||
          item.products ||
          item.product ||
          {};

        const barcode =
          dbProd.barcode ||
          item.products?.barcode ||
          item.barcode ||
          item.product?.barcode ||
          item.ean ||
          "";
        const internalCode =
          dbProd.internal_code ||
          item.products?.internal_code ||
          item.internal_code ||
          item.internalCode ||
          item.product?.internalCode ||
          item.erpProductId ||
          item.erp_product_id ||
          barcode ||
          String(idx + 1);
        const nomeProduto =
          dbProd.name ||
          item.products?.name ||
          item.name ||
          item.productName ||
          item.product?.name ||
          `PRODUTO ${internalCode}`;
        const unidadeMedida =
          item.unidadeMedida ||
          item.unitMeasure ||
          item.unit_measure ||
          item.product?.unitMeasure ||
          "UN";
        const quantidade = Number(item.quantity || item.quantidade || 1);
        const precoUnitario = Number(
          item.unit_price ?? item.price ?? item.preco_unitario ?? dbProd.price ?? 0,
        );
        const precoOriginal = Number(
          item.originalPrice ?? item.original_price ?? dbProd.original_price ?? precoUnitario,
        );
        const descontoUnitario = Number(
          item.descontoUnitario ??
            item.unit_discount ??
            item.discount_per_unit ??
            (item.promotionDiscount && quantidade > 0 ? Number(item.promotionDiscount) / quantidade : 0),
        );
        return {
          id: item.id || dbProd.id || undefined,
          ean: sanitizeInovafarmaEan(barcode),
          barcode: String(barcode || "").trim(),
          codigoProduto: String(internalCode || barcode || idx + 1).trim(),
          internalCode: String(internalCode || "").trim(),
          nome: String(nomeProduto).trim(),
          unidadeMedida,
          quantidade,
          precoUnitario,
          precoOriginal,
          descontoUnitario,
        };
      });

      const retirarNaLoja = targetOrder.delivery_mode === "pickup" || targetOrder.deliveryMode === "pickup";

      const somaLiquidaItens = roundCurrency(
        rawItemsForVenda.reduce(
          (acc: number, it: any) =>
            acc + roundCurrency((it.precoUnitario - (it.descontoUnitario || 0)) * it.quantidade),
          0,
        ),
      );

      const explicitOrderDiscount = roundCurrency(
        Number(
          targetOrder.discount ??
            targetOrder.discount_amount ??
            targetOrder.coupon_discount ??
            targetOrder.couponDiscount ??
            (customer as any)?.couponDiscount ??
            targetOrder.desconto ??
            0,
        ),
      );

      const valorTotalPedido = roundCurrency(
        Number(
          targetOrder.total ??
            targetOrder.total_amount ??
            targetOrder.valor_total ??
            somaLiquidaItens,
        ),
      );

      const inferredDeliveryFee = roundCurrency(
        Math.max(0, valorTotalPedido - Math.max(0, somaLiquidaItens - explicitOrderDiscount)),
      );

      const taxaEntrega = roundCurrency(
        Math.max(
          0,
          Number(
            targetOrder.deliveryFee ??
              targetOrder.delivery_fee ??
              targetOrder.taxa_entrega ??
              (customer as any)?.deliveryFee ??
              inferredDeliveryFee ??
              0,
          ),
        ),
      );

      const somaBrutaItens = somaLiquidaItens;
      const implicitDiscount = roundCurrency(
        Math.max(0, somaBrutaItens + taxaEntrega - valorTotalPedido),
      );
      const descontoGlobalParaDistribuir =
        explicitOrderDiscount > 0 ? explicitOrderDiscount : implicitDiscount;

      const rawSellerCodeInput =
        body.sellerCode ??
        body.seller_code ??
        body.erp_seller_code ??
        body.vendedor ??
        targetOrder.erp_seller_code ??
        targetOrder.seller_code ??
        (customer as any)?.sellerCode ??
        (customer as any)?.erp_seller_code ??
        (customer as any)?._pdv?.sellerCode;

      const parsedSellerDigits =
        rawSellerCodeInput !== undefined && rawSellerCodeInput !== null
          ? String(rawSellerCodeInput).replace(/\D/g, "").trim()
          : "";
      const normalizedSellerCode =
        parsedSellerDigits !== "" && Number(parsedSellerDigits) > 0
          ? Number(parsedSellerDigits)
          : null;

      const rawVendedor =
        normalizedSellerCode ??
        body.vendedor ??
        targetOrder.seller_code ??
        targetOrder.seller_cpf ??
        targetOrder.vendedor_codigo ??
        targetOrder.vendedor_cpf ??
        targetOrder.vendedor;

      const formaPagamento = String(
        targetOrder.paymentMethod ||
          targetOrder.payment_method ||
          targetOrder.forma_pagamento ||
          customer.paymentMethod ||
          "PIX",
      ).trim();

      const codigoVendaOnLine = String(
        targetOrder.codigo_venda_online ||
          targetOrder.codigoVendaOnLine ||
          targetOrder.id,
      ).trim();

      /**
       * Enfileira o pedido para o Agente Local SQL Server (`status = 'pending_erp'`)
       * e responde HTTP 200 imediatamente.
       */
      const enqueueAndRespondForLocalAgent = async () => {
        const updatedCustomer = {
          ...(typeof customer === "object" && customer !== null ? customer : {}),
          ...(normalizedSellerCode ? { sellerCode: normalizedSellerCode, erp_seller_code: normalizedSellerCode } : {}),
          erpError: null,
          _pdv: {
            ...((customer as any)?._pdv || {}),
            status: "pending_erp",
            queuedAt: new Date().toISOString(),
            erpError: null,
            taxaEntrega,
            descontoGlobal: descontoGlobalParaDistribuir,
            enrichedItems: rawItemsForVenda,
            ...(normalizedSellerCode ? { sellerCode: normalizedSellerCode, erp_seller_code: normalizedSellerCode } : {}),
          },
        };

        enqueuePendingErpOrderForTenant(tenant_id, {
          id: targetOrder.id,
          tenantId: tenant_id,
          customer: updatedCustomer,
          items: rawItemsForVenda,
          total: valorTotalPedido,
          taxaEntrega,
          descontoGlobal: descontoGlobalParaDistribuir,
          paymentMethod: formaPagamento,
          changeFor: customer.changeFor || targetOrder.changeFor || "",
          observation: targetOrder.observation || targetOrder.notes || targetOrder.observacao || "",
          deliveryMode: retirarNaLoja ? "pickup" : "delivery",
          date: targetOrder.date || targetOrder.created_at || new Date().toISOString(),
          sellerCode: normalizedSellerCode,
          erp_seller_code: normalizedSellerCode,
        });

        const updatePayloadWithSeller: Record<string, any> = {
          status: "pending_erp",
          customer: updatedCustomer,
        };
        if (normalizedSellerCode) {
          updatePayloadWithSeller.erp_seller_code = String(normalizedSellerCode);
        }

        const { error: queueUpdateErr } = await supabaseAdmin
          .from("orders")
          .update(updatePayloadWithSeller)
          .eq("id", targetOrder.id)
          .eq("tenant_id", tenant_id);

        if (queueUpdateErr) {
          const { error: fallbackCustomerErr } = await supabaseAdmin
            .from("orders")
            .update({
              status: "pending_erp",
              customer: updatedCustomer,
            })
            .eq("id", targetOrder.id)
            .eq("tenant_id", tenant_id);

          if (fallbackCustomerErr) {
            await supabaseAdmin
              .from("orders")
              .update({ status: "pending_erp" })
              .eq("id", targetOrder.id)
              .eq("tenant_id", tenant_id);
          }
        }

        return res.status(200).json({
          success: true,
          queuedForAgent: true,
          mode: "agent_queue",
          status: "pending_erp",
          message: "Pedido enviado para a fila do Agente Local (PDV)",
          codigoVendaOnLine,
          sellerCode: normalizedSellerCode,
        });
      };

      // REGRA PRIORITÁRIA: Sempre envia para a fila do Agente Local (pending_erp),
      // exceto se o Portal PS foi explicitamente forçado e tem login/senha reais configurados.
      if (!canAttemptPortalPsWebApi || !effectiveErpToken) {
        return await enqueueAndRespondForLocalAgent();
      }

      try {
        const vendaPayload = await buildInovafarmaVendaPayload(
          {
            ent: body.ent ?? body.entidade ?? body.codigoEmpresa ?? effectiveErpCnpj ?? "1",
            cnpj: effectiveErpCnpj,
            pedidoId: codigoVendaOnLine,
            codigoVendaOnLine,
            vendedor: rawVendedor,
            retirarNaLoja: false,
            cliente: {
              nome:
                customer.name ||
                customer.nome ||
                targetOrder.customer_name ||
                "Cliente Consumidor",
              cpf: customer.cpf || targetOrder.customer_cpf || "",
              telefone:
                customer.phone ||
                customer.telefone ||
                targetOrder.customer_phone ||
                "",
              endereco: {
                logradouro:
                  customer.address ||
                  customer.street ||
                  customer.rua ||
                  targetOrder.address ||
                  tenantSettings?.street ||
                  tenantSettings?.full_address ||
                  "ENDERECO DE ENTREGA",
                numero:
                  customer.address_number ||
                  customer.addressNumber ||
                  customer.number ||
                  customer.numero ||
                  "S/N",
                bairro:
                  customer.neighborhood ||
                  customer.bairro ||
                  tenantSettings?.neighborhood ||
                  "CENTRO",
                cidade:
                  customer.city ||
                  customer.cidade ||
                  tenantSettings?.city ||
                  "CIDADE",
                uf:
                  customer.state ||
                  customer.uf ||
                  tenantSettings?.state ||
                  "SP",
                cep:
                  customer.cep ||
                  customer.zipCode ||
                  tenantSettings?.cep ||
                  "00000000",
              },
            },
            itens: rawItemsForVenda,
            descontoGlobal: descontoGlobalParaDistribuir,
            taxaEntrega,
            pagamentos: Array.isArray(body.pagamentos)
              ? body.pagamentos
              : undefined,
            formaPagamentoPadrao: formaPagamento,
            observacao: targetOrder.observation || targetOrder.notes || targetOrder.observacao || undefined,
          },
          {
            baseUrl: effectiveErpBaseUrl,
            routeId: effectiveErpRouteId,
            token: effectiveErpToken,
            cnpj: effectiveErpCnpj,
            apiKey: effectiveErpApiKey || undefined,
          },
        );

        const sent = await sendInovafarmaVenda({
          baseUrl: effectiveErpBaseUrl,
          routeId: effectiveErpRouteId,
          token: effectiveErpToken,
          cnpj: effectiveErpCnpj,
          apiKey: effectiveErpApiKey || undefined,
          tenantId: tenant_id,
          supabaseClient: supabaseAdmin,
          venda: {
            ent: vendaPayload.ent,
            cnpj: vendaPayload.cnpj,
            pedidoId: vendaPayload.codigoVendaOnLine,
            codigoVendaOnLine: vendaPayload.codigoVendaOnLine,
            vendedor: vendaPayload.vendedor,
            retirarNaLoja: false,
            cliente: vendaPayload.cliente,
            itens: vendaPayload.itens,
            taxaEntrega: vendaPayload.taxaEntrega,
            pagamentos: vendaPayload.pagamentos,
            observacao: vendaPayload.observacao,
          },
        });

        const codigoVendaInova = sent.codigoVendaInova || null;
        await logIntegration(
          targetOrder.tenant_id,
          sent.endpointUsed,
          vendaPayload,
          "SUCCESS",
        );

        const orderUpdatePayload: Record<string, any> = {
          status: "enviado_ao_pdv",
          codigo_venda_online: vendaPayload.codigoVendaOnLine,
        };
        if (codigoVendaInova) {
          orderUpdatePayload.codigo_venda_inova = codigoVendaInova;
        }

        let { error: updateError } = await supabaseAdmin
          .from("orders")
          .update(orderUpdatePayload)
          .eq("id", targetOrder.id)
          .eq("tenant_id", targetOrder.tenant_id);

        if (updateError && (updateError.code === "42703" || updateError.message?.includes("does not exist"))) {
          await supabaseAdmin
            .from("orders")
            .update({ status: "enviado_ao_pdv" })
            .eq("id", targetOrder.id)
            .eq("tenant_id", targetOrder.tenant_id);
        }

        return res.json({
          success: true,
          erpSent: true,
          message: "Pedido enviado ao PDV Inovafarma com sucesso",
          codigoVendaOnLine: vendaPayload.codigoVendaOnLine,
          codigoVendaInova,
          payload_enviado: vendaPayload,
          erp_response: sent.response,
        });
      } catch (portalPsError: any) {
        console.warn(
          "[Inovafarma Venda] Falha na chamada Portal PS, redirecionando pedido automaticamente para a fila do Agente Local (pending_erp):",
          portalPsError?.message,
        );
        return await enqueueAndRespondForLocalAgent();
      }
    } catch (error: any) {
      const errDetail = String(error?.message || "Erro interno no servidor").slice(0, 2000);
      console.error("Erro ao processar integração ERP (POST /Venda):", errDetail);
      return res.status(400).json({
        error: errDetail,
        details: errDetail,
      });
    }
  },
);

// Fila em memória complementar ao status 'pending_erp' no banco para resposta instantânea ao Agente Local
const pendingErpOrdersByTenant = new Map<string, Map<string, any>>();

function enqueuePendingErpOrderForTenant(tenantId: string, orderPayload: any) {
  if (!tenantId || !orderPayload?.id) return;
  let map = pendingErpOrdersByTenant.get(tenantId);
  if (!map) {
    map = new Map<string, any>();
    pendingErpOrdersByTenant.set(tenantId, map);
  }
  map.set(String(orderPayload.id), orderPayload);
}

function removePendingErpOrderForTenant(tenantId: string, orderId: string) {
  if (!tenantId || !orderId) return;
  const map = pendingErpOrdersByTenant.get(tenantId);
  if (map) {
    map.delete(String(orderId));
  }
}

/**
 * Rota consultada a cada 5s pelo Agente Local (agent-sync) para buscar pedidos na fila 'pending_erp'
 */
app.get(
  [
    "/api/v1/integration/orders/pending",
    "/api/integration/orders/pending",
  ],
  async (req, res) => {
    try {
      const { tenantId } = await resolveTenantForAgent(req);
      let effectiveTenantId =
        tenantId ||
        String(req.query.tenant_id || req.query.tenantId || req.headers["x-tenant-id"] || "").trim();

      // Fallback: se o token x-api-key do agente ainda não bateu diretamente mas há uma única farmácia com pedido 'pending_erp' (ex: Drogaria Macabú)
      if (!effectiveTenantId) {
        if (pendingErpOrdersByTenant.size === 1) {
          effectiveTenantId = Array.from(pendingErpOrdersByTenant.keys())[0];
        } else {
          const { data: anyPending } = await supabaseAdmin
            .from("orders")
            .select("tenant_id")
            .eq("status", "pending_erp")
            .order("date", { ascending: false })
            .limit(1);
          if (anyPending && anyPending.length > 0 && anyPending[0].tenant_id) {
            effectiveTenantId = String(anyPending[0].tenant_id);
          }
        }
      }

      if (!effectiveTenantId) {
        return res.json({ success: true, orders: [] });
      }

      const memMap = pendingErpOrdersByTenant.get(effectiveTenantId);
      const resultMap = new Map<string, any>();

      if (memMap) {
        for (const [id, ord] of memMap.entries()) {
          resultMap.set(id, ord);
        }
      }

      // Consulta também no Supabase pedidos com status = 'pending_erp' (caso o servidor tenha reiniciado ou em múltiplas instâncias)
      const { data: dbPendingOrders } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("tenant_id", effectiveTenantId)
        .eq("status", "pending_erp")
        .order("date", { ascending: true })
        .limit(25);

      if (Array.isArray(dbPendingOrders) && dbPendingOrders.length > 0) {
        for (const dbOrd of dbPendingOrders) {
          if (!resultMap.has(String(dbOrd.id))) {
            const cust = dbOrd.customer || {};
            const pdvMeta = cust._pdv || {};
            let enrichedItems =
              Array.isArray(pdvMeta.enrichedItems) && pdvMeta.enrichedItems.length > 0
                ? pdvMeta.enrichedItems
                : (dbOrd.items || []);

            // Se os itens vieram direto do banco sem codigoProduto/ean enriquecidos, enriquece a partir da tabela products
            const needsEnrichment = enrichedItems.some(
              (it: any) => !it.codigoProduto && !it.internalCode && !it.internal_code,
            );
            if (needsEnrichment && enrichedItems.length > 0) {
              const prodIds = enrichedItems
                .map((it: any) => it.id || it.product_id || it.productId)
                .filter(Boolean);
              const prodMap = new Map<string, any>();
              if (prodIds.length > 0) {
                const { data: pRows } = await supabaseAdmin
                  .from("products")
                  .select("id, name, barcode, internal_code, price, original_price")
                  .eq("tenant_id", effectiveTenantId)
                  .in("id", prodIds);
                if (Array.isArray(pRows)) {
                  for (const pr of pRows) {
                    if (pr.id) prodMap.set(String(pr.id), pr);
                  }
                }
              }
              enrichedItems = enrichedItems.map((it: any, idx: number) => {
                const p = prodMap.get(String(it.id || it.product_id || it.productId || "")) || {};
                const bc = p.barcode || it.barcode || it.ean || "";
                const ic = p.internal_code || it.internalCode || it.internal_code || bc || String(idx + 1);
                return {
                  ...it,
                  ean: String(bc).replace(/\D/g, ""),
                  barcode: String(bc).trim(),
                  codigoProduto: String(ic).trim(),
                  internalCode: String(ic).trim(),
                  nome: String(p.name || it.name || it.nome || `Item #${idx + 1}`).trim(),
                  quantidade: Number(it.quantity ?? it.quantidade ?? 1),
                  precoUnitario: Number(it.price ?? it.precoUnitario ?? p.price ?? 0),
                  precoOriginal: Number(it.originalPrice ?? it.precoOriginal ?? p.original_price ?? it.price ?? 0),
                };
              });
            }

            const resolvedOrderSellerCode =
              dbOrd.erp_seller_code ??
              dbOrd.seller_code ??
              pdvMeta.sellerCode ??
              pdvMeta.erp_seller_code ??
              cust.sellerCode ??
              cust.erp_seller_code ??
              null;

            resultMap.set(String(dbOrd.id), {
              id: dbOrd.id,
              tenantId: effectiveTenantId,
              customer: cust,
              items: enrichedItems,
              total: Number(dbOrd.total) || 0,
              taxaEntrega: Number(pdvMeta.taxaEntrega ?? cust.deliveryFee ?? 0) || 0,
              descontoGlobal: Number(pdvMeta.descontoGlobal ?? cust.couponDiscount ?? 0) || 0,
              paymentMethod: cust.paymentMethod || "PIX",
              changeFor: cust.changeFor || "",
              observation: dbOrd.observation || "",
              deliveryMode: dbOrd.delivery_mode || "delivery",
              date: dbOrd.date || new Date().toISOString(),
              sellerCode: resolvedOrderSellerCode,
              erp_seller_code: resolvedOrderSellerCode,
            });
          }
        }
      }

      return res.json({
        success: true,
        orders: Array.from(resultMap.values()),
      });
    } catch (err: any) {
      console.error("[AGENT ORDERS PENDING ERROR]:", err?.message);
      return res.status(500).json({ error: err?.message || "Erro ao listar pedidos pendentes", orders: [] });
    }
  },
);

/**
 * Rota chamada pelo Agente Local após gravar com sucesso a Pré-Venda nas tabelas Orcamento / Orcamento_Produto / Orcamento_PV
 */
app.post(
  [
    "/api/v1/integration/orders/:orderId/confirm",
    "/api/integration/orders/:orderId/confirm",
  ],
  async (req, res) => {
    try {
      const orderId = String(req.params.orderId || req.body?.orderId || "").trim();
      const { tenantId } = await resolveTenantForAgent(req);
      const body = req.body || {};

      if (!orderId) {
        return res.status(400).json({ error: "orderId é obrigatório." });
      }

      let orderQuery = supabaseAdmin.from("orders").select("*").eq("id", orderId);
      if (tenantId) {
        orderQuery = orderQuery.eq("tenant_id", tenantId);
      }
      const { data: existingOrder } = await orderQuery.maybeSingle();
      const effectiveTenantId = tenantId || existingOrder?.tenant_id;

      if (effectiveTenantId) {
        removePendingErpOrderForTenant(effectiveTenantId, orderId);
      }

      const erpOrderId = body.erpOrderId ?? body.erp_order_id ?? null;
      const numeroCesta = body.numeroCesta ?? body.numero_cesta ?? body.cesta ?? null;
      const codigoVenda = body.codigoVenda ?? body.codigo_venda ?? null;
      const codigoPV = body.codigoPV ?? body.codigo_pv ?? null;
      const codigoOrcamento = body.codigoOrcamento ?? body.codigo_orcamento ?? null;
      const codigoLancamento = body.codigoLancamento ?? body.codigo_lancamento ?? null;
      const codigoEntrega = body.codigoEntrega ?? body.codigo_entrega ?? null;

      const formattedBadge =
        erpOrderId
          ? String(erpOrderId)
          : numeroCesta && codigoVenda
            ? `Cesta #${numeroCesta} (Venda #${codigoVenda})`
            : codigoPV && codigoOrcamento
              ? `Pré-Venda #${codigoPV} • Orç #${codigoOrcamento}`
              : codigoPV
                ? `Pré-Venda #${codigoPV}`
                : codigoOrcamento
                  ? `Orçamento #${codigoOrcamento}`
                  : "Enviado ao PDV";

      const prevCustomer =
        existingOrder?.customer && typeof existingOrder.customer === "object"
          ? existingOrder.customer
          : {};

      const updatedCustomer = {
        ...prevCustomer,
        erpOrderId: formattedBadge,
        numeroCesta,
        codigoVenda,
        codigoOrcamento,
        codigoPV,
        codigoVendaInova: formattedBadge,
        erpError: null,
        _pdv: {
          ...(prevCustomer._pdv || {}),
          status: "enviado_ao_pdv",
          erpOrderId: formattedBadge,
          numeroCesta,
          codigoVenda,
          codigoOrcamento,
          codigoPV,
          codigoLancamento,
          codigoEntrega,
          codigoVendaInova: formattedBadge,
          erpError: null,
          confirmedAt: new Date().toISOString(),
        },
      };

      const updatePayload: Record<string, any> = {
        status: "enviado_ao_pdv",
        customer: updatedCustomer,
      };
      const numericVendaRef = codigoVenda ?? codigoOrcamento;
      if (numericVendaRef && !isNaN(Number(numericVendaRef))) {
        updatePayload.codigo_venda_inova = Number(numericVendaRef);
      }

      let { error: updErr } = await supabaseAdmin
        .from("orders")
        .update(updatePayload)
        .eq("id", orderId);

      if (updErr) {
        await supabaseAdmin
          .from("orders")
          .update({
            status: "enviado_ao_pdv",
            customer: updatedCustomer,
          })
          .eq("id", orderId);
      }

      if (effectiveTenantId) {
        await logIntegration(
          effectiveTenantId,
          "/agent-sync/inovafarma/pre-venda",
          {
            orderId,
            erpOrderId: formattedBadge,
            numeroCesta,
            codigoVenda,
            codigoPV,
            codigoOrcamento,
            codigoLancamento,
            codigoEntrega,
          },
          "SUCCESS",
        );
      }

      return res.json({
        success: true,
        orderId,
        status: "enviado_ao_pdv",
        erpOrderId: formattedBadge,
        numeroCesta,
        codigoVenda,
        codigoPV,
        codigoOrcamento,
        codigoVendaInova: formattedBadge,
      });
    } catch (err: any) {
      console.error("[AGENT ORDER CONFIRM ERROR]:", err?.message);
      return res.status(500).json({ error: err?.message || "Erro ao confirmar pedido do PDV" });
    }
  },
);

/**
 * Rota chamada pelo Agente Local caso ocorra erro SQL ao gravar a Pré-Venda no PDV
 */
app.post(
  [
    "/api/v1/integration/orders/:orderId/error",
    "/api/integration/orders/:orderId/error",
  ],
  async (req, res) => {
    try {
      const orderId = String(req.params.orderId || req.body?.orderId || "").trim();
      const { tenantId } = await resolveTenantForAgent(req);
      const errorMsg = String(req.body?.error || "Falha ao gravar Pré-Venda no banco SQL Server do PDV").slice(0, 1000);

      if (!orderId) {
        return res.status(400).json({ error: "orderId é obrigatório." });
      }

      let orderQuery = supabaseAdmin.from("orders").select("*").eq("id", orderId);
      if (tenantId) {
        orderQuery = orderQuery.eq("tenant_id", tenantId);
      }
      const { data: existingOrder } = await orderQuery.maybeSingle();
      const effectiveTenantId = tenantId || existingOrder?.tenant_id;

      if (effectiveTenantId) {
        removePendingErpOrderForTenant(effectiveTenantId, orderId);
      }

      const prevCustomer =
        existingOrder?.customer && typeof existingOrder.customer === "object"
          ? existingOrder.customer
          : {};

      const updatedCustomer = {
        ...prevCustomer,
        erpError: errorMsg,
        _pdv: {
          ...(prevCustomer._pdv || {}),
          status: "erro_integracao_pdv",
          erpError: errorMsg,
          failedAt: new Date().toISOString(),
        },
      };

      await supabaseAdmin
        .from("orders")
        .update({
          status: "erro_integracao_pdv",
          customer: updatedCustomer,
        })
        .eq("id", orderId);

      if (effectiveTenantId) {
        await logIntegration(
          effectiveTenantId,
          "/agent-sync/inovafarma/pre-venda",
          { orderId },
          "FAILED",
          errorMsg,
        );
      }

      return res.json({
        success: true,
        orderId,
        status: "erro_integracao_pdv",
        error: errorMsg,
      });
    } catch (err: any) {
      console.error("[AGENT ORDER ERROR REPORT EXCEPTION]:", err?.message);
      return res.status(500).json({ error: err?.message || "Erro ao registrar falha do pedido" });
    }
  },
);

app.post("/api/v1/integration/logs/internal", async (req, res) => {
  try {
    const { tenant_id, endpoint, payload, status, error_message } = req.body;
    await logIntegration(tenant_id, endpoint, payload, status, error_message);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Helper for logging
async function logIntegration(
  tenantId: string,
  endpoint: string,
  payload: any,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string,
) {
  try {
    await supabase.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint,
      payload,
      status,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error("Failed to log integration:", e);
  }
}

/**
 * @swagger
 * /sync/inventory:
 *   post:
 *     summary: Webhook Unificado para Sincronização de Vendas e Estoque
 *     description: Recebe dados do sistema da farmácia (ERP) para realizar a baixa de estoque automática (SALE) e a atualização de entradas de mercadoria (PURCHASE).
 *     tags: [Integração]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: Token de integração vinculado ao CNPJ da farmácia
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         required: false
 *         description: ID do Tenant (opcional se o token for único)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [SALE, PURCHASE]
 *                 description: Tipo de operação
 *               ean:
 *                 type: string
 *                 description: Código de barras (EAN)
 *               internalCode:
 *                 type: string
 *                 description: Código interno no ERP
 *               quantity:
 *                 type: number
 *                 description: Quantidade vendida ou comprada
 *               price_sale:
 *                 type: number
 *     responses:
 *       202:
 *         description: Sincronização aceita e enviada para processamento em background
 *       400:
 *         description: Dados inválidos
 *       401:
 *         description: Token inválido
 *       404:
 *         description: Produto não encontrado
 *
 */
app.post(["/api/v1/sync/inventory", "/api/sync/inventory", "/api/v1/desktop-agent/inventory"], async (req, res) => {
  try {
    const { tenant, tenantId, machineId, activationToken } = await resolveTenantForAgent(req);

    if (!tenant || !tenantId) {
      return res.status(401).json({ error: "Token ou Tenant ID inválido" });
    }

    await touchAgentHeartbeat(tenantId, machineId, activationToken);

    const { type, ean, internalCode, quantity, price_sale } = req.body;

    if (!type || !["SALE", "PURCHASE"].includes(type)) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "Tipo de operação inválido",
      );
      return res
        .status(400)
        .json({ error: "Tipo de operação inválido. Use SALE ou PURCHASE." });
    }

    if (!ean && !internalCode) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "EAN ou Código Interno não fornecido",
      );
      return res
        .status(400)
        .json({ error: "É necessário fornecer o EAN ou o Código Interno" });
    }

    if (typeof quantity !== "number" || quantity <= 0) {
      await logIntegration(
        tenantId,
        "/sync/inventory",
        req.body,
        "FAILED",
        "Quantidade inválida",
      );
      return res.status(400).json({ error: "Quantidade inválida" });
    }

    // Push to queue
    await webhookQueue.push({
      tenantId,
      type,
      ean,
      internalCode,
      quantity,
      price_sale,
      originalPayload: req.body,
    });

    res
      .status(202)
      .json({
        success: true,
        message:
          "Sincronização aceita e enviada para processamento em background",
      });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Servico de Mensageria - WhatsApp

app.post("/api/v1/analytics/:tenantId/install", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    const { error } = await supabase.rpc("increment_store_analytics", {
      p_tenant_id: tenantId,
      p_date: date,
      p_increment_installs: 1
    });

    if (error) {
      const { data: existing, error: selectError } = await supabase
        .from("store_analytics")
        .select("id, pwa_installs_count")
        .eq("tenant_id", tenantId)
        .eq("date", date)
        .single();
        
      if (selectError && (selectError.code === "42P01")) {
        // Table missing
      } else if (selectError && selectError.code === "PGRST116") {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, pwa_installs_count: 1 });
      } else if (existing) {
        await supabase
          .from("store_analytics")
          .update({ pwa_installs_count: (existing.pwa_installs_count || 0) + 1 })
          .eq("id", existing.id);
      } else if (!selectError) {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, pwa_installs_count: 1 });
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/analytics/:tenantId/view", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Call the RPC we created or upsert via Supabase JS
    const { error } = await supabase.rpc("increment_store_analytics", {
      p_tenant_id: tenantId,
      p_date: date,
      p_increment_views: 1
    });

    if (error) {
      // Fallback if RPC doesn't exist yet, do simple insert with 1 view
      const { data: existing, error: selectError } = await supabase
        .from("store_analytics")
        .select("id, views_count")
        .eq("tenant_id", tenantId)
        .eq("date", date)
        .single();
        
      if (selectError && (selectError.code === "42P01")) {
        // Table missing, just ignore to prevent crashing until migration is applied
      } else if (selectError && selectError.code === "PGRST116") {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, views_count: 1 });
      } else if (existing) {
        await supabase
          .from("store_analytics")
          .update({ views_count: existing.views_count + 1 })
          .eq("id", existing.id);
      } else if (!selectError) {
        await supabase
          .from("store_analytics")
          .insert({ tenant_id: tenantId, date, views_count: 1 });
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/analytics/:tenantId/track-event", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { productId, productName, source } = req.body;
    
    // We expect the 'access_logs' table to have:
    // id, tenant_id, product_id, product_name, source, created_at
    const { error } = await supabase
      .from("access_logs")
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        product_name: productName,
        source: source || 'direct'
      });
      
    if (error && error.code !== "42P01") {
      console.warn("Error inserting access log:", error.message);
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/analytics/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Get last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];
    
    const { data: recentStats, error } = await supabase
      .from("store_analytics")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("date", dateStr)
      .order("date", { ascending: true });
      
    if (error) {
      console.error("Error fetching recent stats:", error);
    }
    
    // Calc total for the month
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
    
    const { data: monthStats, error: monthError } = await supabase
      .from("store_analytics")
      .select("views_count, pwa_installs_count")
      .eq("tenant_id", tenantId)
      .gte("date", firstDayOfMonth);
      
    if (monthError) {
      console.error("Error fetching month stats:", monthError);
    }
    
    const totalMonthViews = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.views_count || 0), 0) : 0;
    const totalMonthInstalls = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.pwa_installs_count || 0), 0) : 0;
    
    res.json({
      success: true,
      data: {
        recent: recentStats || [],
        totals: {
          views: totalMonthViews,
          installs: totalMonthInstalls
        }
      }
    });
  } catch (err: any) {
    console.error("Error in GET /api/v1/analytics: ", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/tenants/:tenantId/messages/whatsapp", async (req, res) => {
  try {
    const { orderId, customerName, customerPhone } = req.body;

    if (!orderId || !customerName || !customerPhone) {
      return res.status(400).json({ error: "Dados incompletos para envio de mensagem." });
    }

    // Aqui seria feita a integracao com a API oficial do WhatsApp Business ou provedor/webhook (ex: Twilio, Z-API, Evolution API)
    // Para fins do teste atual, simularemos o delay e o log de sucesso.
    console.log(`[WHATSAPP API] Notificação enviada com sucesso!
Para: ${customerPhone}
Mensagem: "Olá, ${customerName}! 🛵 Seu pedido da Farmácia já foi separado e acabou de sair para entrega com o nosso motoboy. Em breve ele estará aí!"`);

    // Resposta de sucesso simulada
    return res.json({ success: true, message: "Mensagem enviada com sucesso." });
  } catch (error: any) {
    console.error("Erro interno no disparo do WhatsApp:", error);
    return res.status(500).json({ error: "Falha ao enviar mensagem de WhatsApp." });
  }
});




// Rate Limiter para a rota de cálculo de frete
const deliveryFeeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10, // Máximo de 10 requisições por IP por minuto
  message: { error: "Muitas requisições para cálculo de frete. Tente novamente em alguns segundos." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
    return (Array.isArray(ip) ? ip[0] : ip) || '';
  },
});

app.post("/api/checkout/delivery-fee", deliveryFeeLimiter, async (req, res) => {
  try {
    const { tenantId, customerAddress, orderTotal } = req.body;
    
    if (!tenantId || !customerAddress) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    // 1. Fetch tenant to get delivery settings and store address
    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('delivery_settings, full_address')
      .eq('id', tenantId)
      .single();
      
    if (error || !tenant) {
      console.error("Erro ao buscar tenant:", error);
      return res.status(404).json({ error: "Farmácia não encontrada." });
    }

    const settings = tenant.delivery_settings;
    const addressFromDatabase = tenant.full_address;
    
    const dType = settings?.delivery_fee_type || settings?.type || 'fixed';

    // Fallback: If no settings or disabled, free delivery
    if (!settings || !settings.enabled) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Check for Free Delivery by order amount
    if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Modalidade Taxa por Bairro
    if (dType === 'neighborhood') {
      const { neighborhood, customerAddress } = req.body;
      let targetNeighborhood = (neighborhood || '').trim().toLowerCase();

      if (!targetNeighborhood && customerAddress) {
        const parts = customerAddress.split('-');
        if (parts.length > 1) {
          const sub = parts[1].split(',')[0].trim();
          if (sub) targetNeighborhood = sub.toLowerCase();
        }
      }

      const activeNeighborhoods = (settings.neighborhoods || []).filter((n: any) => n.active !== false);
      const matched = activeNeighborhoods.find(
        (n: any) => n.name.trim().toLowerCase() === targetNeighborhood
      );

      if (matched) {
        return res.json({
          fee: Number(matched.fee) || 0,
          isFreeDelivery: false,
          distanceKm: 0,
          success: true,
          neighborhood: matched.name,
          estimated_time: matched.estimated_time
        });
      }

      if (settings.defaultNeighborhoodFee !== undefined && Number(settings.defaultNeighborhoodFee) > 0) {
        return res.json({
          fee: Number(settings.defaultNeighborhoodFee),
          isFreeDelivery: false,
          distanceKm: 0,
          success: true,
          fallback: true
        });
      }

      if (activeNeighborhoods.length > 0) {
        return res.json({
          fee: 0,
          isFreeDelivery: false,
          distanceKm: 0,
          success: false,
          message: "Seu bairro está fora da nossa área de tele-entrega."
        });
      }

      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, distanceKm: 0, success: true });
    }

    // Fixed Fee
    if (dType === 'fixed') {
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, distanceKm: 0, success: true });
    }

    // Dynamic Fee - Needs distance calculation
    if (dType === 'dynamic' || dType === 'distance') {
      if (!addressFromDatabase) {
        console.warn("Endereço da loja não configurado no banco de dados.");
        return res.status(400).json({ 
          success: false, 
          message: "Endereço da loja não configurado", 
          error: "Endereço da loja não configurado" 
        });
      }
      const storeAddress = addressFromDatabase;
      // Security Fallback 1: If store address is missing, fallback to max fee or manual mode
      if (!storeAddress) {
        console.warn("Endereço da loja não configurado.");
        return res.json({ 
          fee: settings.fee || 0, // Fallback to base fixed fee
          isFreeDelivery: false, 
          distanceKm: 0, 
          success: false, 
          message: "Endereço da loja não configurado. Aplicando taxa base." 
        });
      }

      let distanceKm = 0;
      let fromCache = false;

      // Otimização: Cache de Rotas (Supabase)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: cachedDistance, error: cacheError } = await supabaseAdmin
          .from('delivery_distance_cache')
          .select('distance_km')
          .eq('origin_address', storeAddress)
          .eq('destination_address', customerAddress)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .limit(1)
          .single();

        if (cachedDistance && !cacheError) {
           distanceKm = cachedDistance.distance_km;
           fromCache = true;
           console.log("[Delivery Cache] Hit:", distanceKm, "km");
        }
      } catch (e) {
        // Ignorar erros de cache (ex: tabela ainda não foi criada)
        console.log("[Delivery Cache] Erro ao ler cache (ignorado)");
      }

      if (!fromCache) {
        // Validação de Origem: log de verificação que imprime no terminal exatamente qual endereço está sendo enviado
        console.log('Calculando rota de:', addressFromDatabase);

        // 2. Calculate Distance using Google Maps API
        const distanceResult = await calculateDeliveryDistance(addressFromDatabase, customerAddress);
        
        // Security Fallback 2: Se a API falhar (ex: OVER_QUERY_LIMIT)
        if (!distanceResult.success) {
          console.warn("Falha na API de Mapas:", distanceResult.message);
          
          if (distanceResult.isFallback) {
             return res.json({
               fee: 0, 
               isFreeDelivery: false,
               distanceKm: 0,
               success: false,
               message: "Cota de cálculo de frete excedida. Por favor, verifique o frete com a loja.",
               fallback: false
             });
          }

          // Heuristic: Check if customer city matches store city
          const storeCityMatch = addressFromDatabase.match(/,\s*([^,]+)(?:\s*-\s*[A-Z]{2})?$/);
          const customerCityMatch = customerAddress.match(/,\s*([^,]+)(?:\s*-\s*[A-Z]{2})?(?:\s*-\s*CEP.*)?$/i);
          
          const storeCity = storeCityMatch ? storeCityMatch[1].trim().toLowerCase() : "";
          const customerCity = customerCityMatch ? customerCityMatch[1].trim().toLowerCase() : "";

          if (storeCity && customerCity && storeCity !== customerCity) {
            console.log(`[Delivery Fallback] Cidades diferentes: ${storeCity} vs ${customerCity}. Bloqueando.`);
            return res.json({
              fee: 0,
              isFreeDelivery: false,
              distanceKm: 0,
              success: false,
              message: "Seu endereço está fora da nossa área de entrega (cidade diferente).",
              fallback: false
            });
          }

          console.log(`[Delivery Fallback] Cidades coincidem (${storeCity}) ou falha na extração. Permitindo 'A combinar'.`);
          return res.json({
            fee: -1,
            isFreeDelivery: false,
            distanceKm: 0,
            success: true, // Allow it to proceed
            fallback: true
          });
        }

        distanceKm = distanceResult.distanceKm;

        // Salvar no Cache de Rotas (se der erro, ignoramos silenciosamente)
        try {
          await supabaseAdmin
            .from('delivery_distance_cache')
            .insert({
               origin_address: storeAddress,
               destination_address: customerAddress,
               distance_km: distanceKm,
               created_at: new Date().toISOString()
            });
        } catch (e) {}
      }

      // 3. Get delivery fee ranges, prioritizing JSON column and falling back to SQL table
      let rangesToUse = [];

      if (settings.ranges && settings.ranges.length > 0) {
        rangesToUse = settings.ranges.map((r: any) => ({
          minKm: Number(r.minKm ?? 0),
          maxKm: Number(r.maxKm ?? 0),
          fee: Number(r.fee ?? 0)
        }));
      }

      if (rangesToUse.length === 0) {
        const { data: dbFees, error: dbFeesError } = await supabaseAdmin
          .from('delivery_fees')
          .select('min_km, max_km, fee')
          .eq('tenant_id', tenantId);
        
        if (!dbFeesError && dbFees && dbFees.length > 0) {
          rangesToUse = dbFees.map((f: any) => ({
            minKm: Number(f.min_km ?? 0),
            maxKm: Number(f.max_km ?? 0),
            fee: Number(f.fee ?? 0)
          }));
        }
      }

      // If no ranges are configured at all, fallback to base fee
      if (rangesToUse.length === 0) {
        console.log(`[Delivery Calculation] No ranges configured for tenant ${tenantId}. Fallback to base fee: R$ ${settings.fee || 0}`);
        return res.json({
          fee: settings.fee || 0,
          isFreeDelivery: false,
          distanceKm,
          success: true
        });
      }

      // Sort ranges by maxKm ascending to evaluate them sequentially and prevent gaps
      rangesToUse.sort((a, b) => a.maxKm - b.maxKm);
      const maxKmLimit = rangesToUse[rangesToUse.length - 1].maxKm;

      console.log(`[Delivery Calculation] Tenant: ${tenantId}, Distance: ${distanceKm} km, Max Limit: ${maxKmLimit} km`);

      if (distanceKm > maxKmLimit) {
        console.log(`[Delivery Calculation] Distance ${distanceKm} km exceeds maximum limit of ${maxKmLimit} km.`);
        return res.json({ 
          fee: 0, 
          isFreeDelivery: false, 
          distanceKm, 
          success: false, 
          message: "Seu endereço está fora da nossa área de entrega." 
        });
      }

      // Match the first range where distanceKm is less than or equal to maxKm (handles gaps beautifully)
      let matchedRange = null;
      for (const range of rangesToUse) {
        if (distanceKm <= range.maxKm) {
          matchedRange = range;
          break;
        }
      }

      if (matchedRange) {
        console.log(`[Delivery Calculation] Matched range: ${matchedRange.minKm}-${matchedRange.maxKm} km, Fee: R$ ${matchedRange.fee}`);
        return res.json({ 
          fee: matchedRange.fee, 
          isFreeDelivery: false, 
          distanceKm, 
          success: true 
        });
      }

      // Safe fallback if loop somehow doesn't match
      return res.json({ 
        fee: settings.fee || 0, 
        isFreeDelivery: false, 
        distanceKm, 
        success: false, 
        message: "Nenhuma faixa de entrega encontrada para esta distância.",
        fallback: true
      });
    }

    res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
  } catch (err) {
    console.error("Erro no delivery-fee:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/checkout/calculate-delivery", async (req, res) => {
  try {
    const { distanceKm, orderTotal, tenantId } = req.body;
    
    if (typeof distanceKm !== 'number' || typeof orderTotal !== 'number' || !tenantId) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    const { data: tenant, error } = await supabaseAdmin
      .from('tenants')
      .select('delivery_settings')
      .eq('id', tenantId)
      .single();
      
    if (error || !tenant) {
      return res.status(404).json({ error: "Farmácia não encontrada." });
    }

    const settings = tenant.delivery_settings;
    
    if (!settings || !settings.enabled) {
      return res.json({ fee: 0, isFreeDelivery: true, success: true });
    }

    if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
      return res.json({ fee: 0, isFreeDelivery: true, success: true });
    }

    const dType = settings.delivery_fee_type || settings.type || 'fixed';

    if (dType === 'neighborhood') {
      const { neighborhood } = req.body;
      const targetNeighborhood = (neighborhood || '').trim().toLowerCase();
      const activeNeighborhoods = (settings.neighborhoods || []).filter((n: any) => n.active !== false);
      const matched = activeNeighborhoods.find(
        (n: any) => n.name.trim().toLowerCase() === targetNeighborhood
      );
      if (matched) {
        return res.json({ fee: Number(matched.fee) || 0, isFreeDelivery: false, success: true });
      }
      if (settings.defaultNeighborhoodFee !== undefined && Number(settings.defaultNeighborhoodFee) > 0) {
        return res.json({ fee: Number(settings.defaultNeighborhoodFee), isFreeDelivery: false, success: true });
      }
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, success: true });
    }

    if (dType === 'fixed') {
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, success: true });
    }

    if (settings.type === 'dynamic' && settings.ranges && settings.ranges.length > 0) {
      const sortedRanges = [...settings.ranges].sort((a, b) => a.minKm - b.minKm);
      
      for (const range of sortedRanges) {
        if (distanceKm >= range.minKm && distanceKm <= range.maxKm) {
          return res.json({ fee: range.fee, isFreeDelivery: false, success: true });
        }
      }
      
      const maxRange = sortedRanges[sortedRanges.length - 1];
      if (distanceKm > maxRange.maxKm) {
        return res.json({ fee: 0, isFreeDelivery: false, success: false, message: "Fora da área de entrega." });
      }
      
      return res.json({ fee: 0, isFreeDelivery: false, success: false, message: "Não foi possível calcular a taxa para esta distância (Faixa não mapeada)." });
    }

    res.json({ fee: 0, isFreeDelivery: true, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isValidRealDeliveryAddress(street?: string, neighborhood?: string, cep?: string): boolean {
  if (!street) return false;
  const s = street.trim().toLowerCase();
  const n = (neighborhood || "").trim().toLowerCase();
  const c = (cep || "").trim().toLowerCase();

  const isPickupKeyword = (val: string) => {
    return (
      val.includes("retirada") ||
      val.includes("retirar") ||
      val.includes("balcao") ||
      val.includes("balcão") ||
      val === "loja" ||
      val === "nossa loja" ||
      val.includes("não informado") ||
      val.includes("nao informado")
    );
  };

  if (isPickupKeyword(s) || isPickupKeyword(n) || isPickupKeyword(c)) {
    return false;
  }

  return s.length >= 3;
}

app.get("/api/checkout/address-lookup", async (req, res) => {
  try {
    const { whatsapp, tenant_id } = req.query;
    if (!whatsapp || !tenant_id) {
      return res.status(400).json({ error: "whatsapp and tenant_id are required" });
    }

    const { data, error } = await supabase
      .from("delivery_addresses")
      .select("customer_name, cep, street, number, complement, neighborhood, city")
      .eq("tenant_id", tenant_id as string)
      .eq("whatsapp", (whatsapp as string).replace(/\D/g, ""))
      .single();

    if (error) {
      // PGRST116 means zero rows found
      if (error.code === "PGRST116" || error.code === "42P01") {
        return res.json({ found: false });
      }
      return res.status(500).json({ error: error.message });
    }

    if (data) {
      const hasRealAddress = isValidRealDeliveryAddress(data.street, data.neighborhood, data.cep);
      const cleanCep = (data.cep || "").replace(/\D/g, "");
      const hasValidName = data.customer_name && !data.customer_name.toLowerCase().includes("retirada");

      if (!hasRealAddress) {
        // Se continha apenas dados corrompidos de retirada no registro legado, não repassa endereço de retirada
        if (hasValidName) {
          return res.json({
            found: true,
            hasAddress: false,
            data: {
              customer_name: data.customer_name,
              cep: "",
              street: "",
              neighborhood: "",
              city: "",
              number: "",
              complement: ""
            }
          });
        }
        return res.json({ found: false });
      }

      res.json({
        found: true,
        hasAddress: true,
        data: {
          customer_name: hasValidName ? data.customer_name : "",
          cep: cleanCep.length === 8 ? data.cep : (cleanCep.length > 0 ? data.cep : ""),
          street: data.street,
          neighborhood: data.neighborhood,
          city: data.city,
          number: data.number || "",
          complement: data.complement || ""
        }
      });
    } else {
      res.json({ found: false });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


// Endpoint para baixa de estoque via checkout
app.post("/api/checkout/deduct-stock", async (req, res) => {
  try {
    const { tenantId, items } = req.body;
    if (!tenantId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid parameters" });
    }
    
    for (const item of items) {
      if (!item.id) continue;
      
      const { data: prod } = await supabaseAdmin
        .from('products')
        .select('stock, is_featured')
        .eq('id', item.id)
        .single();
        
      if (prod && typeof prod.stock === 'number') {
        const newStock = Math.max(0, prod.stock - item.quantity);
        await supabaseAdmin
          .from('products')
          .update({ 
            stock: newStock,
            is_featured: newStock === 0 ? false : prod.is_featured 
          })
          .eq('id', item.id);
          
        console.log(`[ESTOQUE] Produto ID ${item.id} atualizado após venda. Novo estoque: ${newStock}`);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Erro ao deduzir estoque:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/checkout/address-save", async (req, res) => {
  try {
    const { tenant_id, whatsapp, customer_name, cep, street, number, neighborhood, city, complement, delivery_mode } = req.body;
    if (!tenant_id || !whatsapp) {
      return res.status(400).json({ error: "whatsapp and tenant_id are required" });
    }

    // Se o pedido for retirada na loja, NÃO sobrescrever nem salvar endereço de entrega residencial!
    if (delivery_mode === "pickup" || delivery_mode === "retirada") {
      return res.json({ success: true, message: "Pickup address ignored" });
    }

    // Validar se o endereço enviado é um endereço de entrega real e válido
    if (!isValidRealDeliveryAddress(street, neighborhood, cep)) {
      return res.json({ success: true, message: "Non-delivery address ignored" });
    }

    const cleanWhatsapp = whatsapp.replace(/\D/g, "");
    const cleanCep = (cep || "").replace(/\D/g, "");
    
    // Upsert into delivery_addresses (using unique constraint on tenant_id, whatsapp)
    const { error } = await supabase
      .from("delivery_addresses")
      .upsert({
        tenant_id,
        whatsapp: cleanWhatsapp,
        customer_name,
        cep: cleanCep.length === 8 ? cep : (cleanCep.length > 0 ? cep : ""),
        street: street.trim(),
        number: (number || "").toString().trim(),
        neighborhood: (neighborhood || "").trim(),
        city: (city || "").trim(),
        complement: (complement || "").trim(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,whatsapp'
      });

    if (error && error.code !== "42P01") {
        return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/coupons/validate", async (req, res) => {
  try {
    const { tenant_id, code } = req.body;
    
    if (!tenant_id || !code) {
      return res.status(400).json({ error: "MISSING_DATA", message: "ID do tenant e código do cupom são obrigatórios." });
    }

    const cleanCode = code.trim().toUpperCase();

    // Query tenant to check for network/matrix ID
    const { data: tenant } = await supabase
      .from("tenants")
      .select("network_id")
      .eq("id", tenant_id)
      .single();
    const networkId = tenant?.network_id;

    let tenantOrClause = `tenant_id.eq.${tenant_id},tenant_id.is.null`;
    if (networkId) {
      tenantOrClause += `,tenant_id.eq.${networkId}`;
    }

    // Query both tenant-specific, matrix-specific and global coupons
    const { data: coupons, error } = await supabase
      .from("coupons")
      .select("*")
      .ilike("code", cleanCode)
      .or(tenantOrClause);

    if (error) {
      return res.status(500).json({ error: "DATABASE_ERROR", message: error.message });
    }

    if (!coupons || coupons.length === 0) {
      return res.status(404).json({ error: "COUPON_NOT_FOUND", message: "Cupom inválido ou não encontrado." });
    }

    // Since we used ilike, find the exact match case-insensitively just to be safe although the query already filters
    const coupon = coupons.find(c => c.code.toUpperCase() === cleanCode);
    
    if (!coupon) {
       return res.status(404).json({ error: "COUPON_NOT_FOUND", message: "Cupom inválido ou não encontrado." });
    }

    // Mapping DB coupon to app expected format
    const appCoupon = {
       id: coupon.id,
       code: coupon.code,
       discountType: coupon.discount_type || coupon.discounttype,
       discountValue: coupon.discount_value || coupon.discountvalue,
       couponScope: coupon.coupon_scope || coupon.couponscope,
       minPurchaseValue: coupon.min_purchase_value || coupon.minpurchasevalue,
       targetType: coupon.target_type || coupon.targettype,
       targetValue: coupon.target_value || coupon.targetvalue,
       specificProductIds: coupon.specific_product_ids || coupon.specificproductids,
       filtersMetadata: coupon.filters_metadata || coupon.filtersmetadata,
       startDate: coupon.start_date || coupon.startdate,
       endDate: coupon.end_date || coupon.enddate,
       isActive: coupon.is_active !== false && coupon.isactive !== false,
    };

    if (!appCoupon.isActive) {
      return res.status(400).json({ error: "COUPON_INACTIVE", message: "Este cupom não está mais ativo." });
    }

    const now = new Date();
    const start = appCoupon.startDate ? new Date(appCoupon.startDate) : null;
    let end = null;
    
    if (appCoupon.endDate) {
      if (appCoupon.endDate.includes("T")) {
        end = new Date(appCoupon.endDate);
      } else {
        const [year, month, day] = appCoupon.endDate.split("-");
        end = new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
      }
    }

    if (start && now < start) {
      return res.status(400).json({ error: "COUPON_NOT_YET_VALID", message: "Este cupom ainda não é válido." });
    }
    if (end && now > end) {
      return res.status(400).json({ error: "COUPON_EXPIRED", message: "Este cupom já expirou." });
    }

    res.json({ success: true, coupon: appCoupon });
  } catch (e: any) {
    res.status(500).json({ error: "SERVER_ERROR", message: e.message });
  }
});

// Setup Swagger
setupSwagger(app);

// --- VITE MIDDLEWARE ---


app.post("/api/v1/agent/promotion-settings", async (req, res) => {
  try {
    const { tenant_id, ignore_promotion_campaigns } = req.body || {};
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id é obrigatório" });
    }

    const { data: existingTenant } = await supabaseAdmin
      .from("tenants")
      .select("id, delivery_settings")
      .eq("id", tenant_id)
      .maybeSingle();

    const updatedDeliverySettings = {
      ...(existingTenant?.delivery_settings || {}),
      ignore_promotion_campaigns: Boolean(ignore_promotion_campaigns),
    };

    const { error: updateErr } = await supabaseAdmin
      .from("tenants")
      .update({ delivery_settings: updatedDeliverySettings })
      .eq("id", tenant_id);

    if (updateErr) {
      throw updateErr;
    }

    agentTenantResolutionCache.delete(String(tenant_id));
    res.json({
      success: true,
      ignore_promotion_campaigns: Boolean(ignore_promotion_campaigns),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/agent/generate-token", async (req, res) => {
  try {
    const { tenant_id, ignore_promotion_campaigns } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id é obrigatório" });
    }

    if (typeof ignore_promotion_campaigns === "boolean") {
      try {
        const { data: existingTenant } = await supabaseAdmin
          .from("tenants")
          .select("id, delivery_settings")
          .eq("id", tenant_id)
          .maybeSingle();
        await supabaseAdmin
          .from("tenants")
          .update({
            delivery_settings: {
              ...(existingTenant?.delivery_settings || {}),
              ignore_promotion_campaigns,
            },
          })
          .eq("id", tenant_id);
        agentTenantResolutionCache.delete(String(tenant_id));
      } catch (_) {}
    }

    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    const token = `FF-${randomHex}`;

    const { data, error } = await supabaseAdmin
      .from('activation_tokens')
      .insert({
        token,
        tenant_id,
        is_used: false
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ success: true, token: data.token });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.all(["/api/v1/agent/activate", "/api/agent/activate", "/api/v1/integration/activate", "/api/v1/desktop-agent/activate"], async (req, res) => {
  try {
    const { token, machineId, machine_id, machine, hostname } = req.body || {};
    const headerMachineId = req.headers['x-machine-id'] || req.headers['machine-id'];
    const mId = machineId || machine_id || machine || hostname || headerMachineId || 'unknown';

    if (!token) {
      return res.status(400).json({ error: "Token não fornecido" });
    }

    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from('activation_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      return res.status(404).json({ error: "Token inválido ou não encontrado" });
    }

    await supabaseAdmin
      .from('activation_tokens')
      .update({ is_used: true })
      .eq('id', tokenData.id);

    await touchAgentHeartbeat(tokenData.tenant_id, mId, token);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    res.json({
      tenantId: tokenData.tenant_id,
      supabaseUrl,
      supabaseAnonKey
    });
  } catch (error: any) {
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

// Dedicated and highly robust agent download route to serve installer zip files directly with proper binary headers
app.get(["/installers/:filename", "/public/installers/:filename"], (req, res) => {
  try {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(process.cwd(), "public", "installers", filename);

    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.sendFile(filePath);
    } else {
      return res.status(404).send("Arquivo de instalador não encontrado");
    }
  } catch (err: any) {
    console.error("[Installers Download Error]", err);
    return res.status(500).send("Erro ao baixar o instalador");
  }
});

app.get("/api/v1/agent/download/:erpType", (req, res) => {
  try {
    const rawType = String(req.params.erpType || "").toLowerCase().trim();
    let fileName = "farmaflow-agent.zip";
    if (rawType === "inovafarma" || rawType.includes("inova")) {
      fileName = "farmaflow-inovafarma.zip";
    } else if (rawType === "siagold") {
      fileName = "farmaflow-siagold.zip";
    } else if (rawType === "softpharma") {
      fileName = "farmaflow-softpharma.zip";
    }

    const filePath = path.join(process.cwd(), "public", "installers", fileName);
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.sendFile(filePath);
    } else {
      const fallbackPath = path.join(process.cwd(), "public", "installers", "farmaflow-agent.zip");
      if (fs.existsSync(fallbackPath)) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        return res.sendFile(fallbackPath);
      }
      return res.redirect(302, `/installers/${fileName}`);
    }
  } catch (err: any) {
    console.error("[Agent Download] Erro interno no manipulador de download do agente:", err);
    return res.status(500).json({ error: "Erro interno ao processar o download do agente." });
  }
});

interface AgentTenantResolution {
  tenant: any | null;
  tenantId: string | null;
  machineId: string | null;
  activationToken: string | null;
}

const agentTenantResolutionCache = new Map<string, { tenant: any; matchedToken: string | null; expiresAt: number }>();
const AGENT_TENANT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const lastAgentHeartbeatDbWriteMap = new Map<string, number>();

async function resolveTenantForAgent(req: express.Request): Promise<AgentTenantResolution> {
  const body = req.body || {};
  const query = req.query || {};
  const headers = req.headers || {};

  // Extrair todos os possíveis tokens / chaves / identificadores enviados pelo Agente Desktop
  const authHeader = headers['authorization'] ? String(headers['authorization']).replace(/^Bearer\s+/i, '').trim() : '';
  const headerApiKey = (headers['x-api-key'] || headers['api-key'] || headers['apikey'] || headers['x-token'] || headers['token']) as string;
  const headerTenantId = (headers['x-tenant-id'] || headers['x-store-id'] || headers['tenant-id'] || headers['store-id'] || headers['x-store-slug']) as string;
  
  const bodyToken = (body.token || body.activation_token || body.activationToken) as string;
  const bodyApiKey = (body.apiKey || body.api_key || body.apikey) as string;
  const bodyTenantId = (body.tenantId || body.tenant_id || body.storeId || body.store_id || body.slug || body.store_slug || body.pharmacyId) as string;

  const queryToken = (query.token || query.activation_token) as string;
  const queryApiKey = (query.apiKey || query.api_key || query.apikey) as string;
  const queryTenantId = (query.tenantId || query.tenant_id || query.storeId || query.store_id || query.slug || query.store_slug) as string;

  const headerMachineId = (headers['x-machine-id'] || headers['machine-id']) as string;
  const machineId = (body.machineId || body.machine_id || body.machine || body.hostname || query.machineId || query.machine_id || headerMachineId || 'unknown') as string;

  const rawCandidates = [
    authHeader,
    headerApiKey,
    headerTenantId,
    bodyToken,
    bodyApiKey,
    bodyTenantId,
    queryToken,
    queryApiKey,
    queryTenantId
  ].filter(Boolean).map(c => String(c).trim()).filter(c => c.length > 0);

  // Criar conjunto higienizado de chaves de busca
  const lookupKeys = new Set<string>();
  for (const raw of rawCandidates) {
    lookupKeys.add(raw);
    const clean = raw.replace(/^store_/, '').replace(/^tenant_/, '').trim();
    if (clean) lookupKeys.add(clean);
  }

  let foundTenant: any = null;
  let matchedToken: string | null = bodyToken || queryToken || null;
  const nowMs = Date.now();

  // 0. Fast-path: Cache em memória (< 1ms) para evitar múltiplas queries no Supabase a cada lote/heartbeat
  for (const key of lookupKeys) {
    const cached = agentTenantResolutionCache.get(key);
    if (cached && cached.expiresAt > nowMs && cached.tenant) {
      return {
        tenant: cached.tenant,
        tenantId: cached.tenant.id || null,
        machineId: machineId && machineId !== 'unknown' ? machineId : null,
        activationToken: matchedToken || cached.matchedToken || null
      };
    }
  }

  console.log(`[DESKTOP AGENT PING] Buscando identificação do tenant. URL: ${req.originalUrl}, Método: ${req.method}, Chaves:`, Array.from(lookupKeys));

  if (lookupKeys.size > 0) {
    const keyArray = Array.from(lookupKeys);
    
    // 1. Busca por integration_token na tabela tenants
    for (const key of keyArray) {
      try {
        const { data: byTokenRows } = await supabaseAdmin
          .from('tenants')
          .select('*')
          .eq('integration_token', key)
          .limit(1);
        if (byTokenRows && byTokenRows.length > 0) {
          foundTenant = byTokenRows[0];
          break;
        }
      } catch (e) {}
    }

    // 2. Busca prioritária por id (string ou UUID) na tabela tenants
    if (!foundTenant) {
      for (const key of keyArray) {
        try {
          const { data: byIdRows } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', key)
            .limit(1);
          if (byIdRows && byIdRows.length > 0) {
            foundTenant = byIdRows[0];
            break;
          }
        } catch (e) {}
      }
    }

    // 3. Fallback por slug na tabela tenants
    if (!foundTenant) {
      for (const key of keyArray) {
        try {
          const { data: bySlugRows } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('slug', key)
            .limit(1);
          if (bySlugRows && bySlugRows.length > 0) {
            foundTenant = bySlugRows[0];
            break;
          }
        } catch (e) {}
      }
    }
  }

  // 4. Se ainda não encontrou, busca na tabela activation_tokens
  if (!foundTenant && lookupKeys.size > 0) {
    for (const key of Array.from(lookupKeys)) {
      try {
        const { data: tokenRows } = await supabaseAdmin
          .from('activation_tokens')
          .select('tenant_id, token')
          .eq('token', key)
          .limit(1);
        const tokenRow = tokenRows?.[0];
        if (tokenRow?.tenant_id) {
          matchedToken = tokenRow.token;
          const { data: tRows } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', tokenRow.tenant_id)
            .limit(1);
          if (tRows && tRows.length > 0) {
            foundTenant = tRows[0];
            break;
          }
        }
      } catch (e) {}
    }
  }

  // 5. Se ainda não encontrou, busca na tabela agent_integrations por activation_token ou tenant_id
  if (!foundTenant && lookupKeys.size > 0) {
    for (const key of Array.from(lookupKeys)) {
      try {
        const { data: agentRows } = await supabaseAdmin
          .from('agent_integrations')
          .select('tenant_id, activation_token')
          .or(`activation_token.eq.${key},tenant_id.eq.${key}`)
          .limit(1);
        const agentRow = agentRows?.[0];
        if (agentRow?.tenant_id) {
          if (!matchedToken && agentRow.activation_token) matchedToken = agentRow.activation_token;
          const { data: tRows } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', agentRow.tenant_id)
            .limit(1);
          if (tRows && tRows.length > 0) {
            foundTenant = tRows[0];
            break;
          }
        }
      } catch (e) {}
    }
  }

  if (foundTenant) {
    const cacheEntry = {
      tenant: foundTenant,
      matchedToken,
      expiresAt: nowMs + AGENT_TENANT_CACHE_TTL_MS
    };
    for (const key of lookupKeys) {
      agentTenantResolutionCache.set(key, cacheEntry);
    }
    if (foundTenant.id) agentTenantResolutionCache.set(String(foundTenant.id), cacheEntry);
    if (foundTenant.slug) agentTenantResolutionCache.set(String(foundTenant.slug), cacheEntry);
    if (foundTenant.integration_token) agentTenantResolutionCache.set(String(foundTenant.integration_token), cacheEntry);
    if (matchedToken) agentTenantResolutionCache.set(String(matchedToken), cacheEntry);
  }

  return {
    tenant: foundTenant,
    tenantId: foundTenant?.id || null,
    machineId: machineId && machineId !== 'unknown' ? machineId : null,
    activationToken: matchedToken
  };
}

async function touchAgentHeartbeat(tenantId: string, machineId?: string | null, activationToken?: string | null, forceDbWrite = false) {
  if (!tenantId) return;
  const nowMs = Date.now();
  const lastWrite = lastAgentHeartbeatDbWriteMap.get(tenantId) || 0;
  // Evita escritas redundantes no Supabase caso vários lotes cheguem em sequência dentro de 15s
  if (!forceDbWrite && nowMs - lastWrite < 15000) {
    return;
  }
  lastAgentHeartbeatDbWriteMap.set(tenantId, nowMs);

  const now = new Date(nowMs).toISOString();
  try {
    const payload: any = {
      tenant_id: tenantId,
      last_seen: now,
      is_active: true
    };
    if (machineId && machineId !== 'unknown') {
      payload.machine_id = machineId;
    }
    if (activationToken) {
      payload.activation_token = activationToken;
    }

    // 1. Tenta atualizar linha existente em agent_integrations
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from('agent_integrations')
      .update(payload)
      .eq('tenant_id', tenantId)
      .select();

    if (!updateErr && updatedRows && updatedRows.length > 0) {
      console.log(`[AGENT DB WRITE] Sucesso: atualizado agent_integrations para tenant: "${tenantId}", last_seen: "${now}"`);
    } else {
      // 2. Tenta upsert/insert com fallback
      const { error: upsertErr } = await supabaseAdmin
        .from('agent_integrations')
        .upsert(payload, { onConflict: 'tenant_id' });
      
      if (upsertErr) {
        console.warn(`[AGENT DB WRITE] Upsert em agent_integrations falhou (${upsertErr.message}), tentando insert direto...`);
        const { error: insertErr } = await supabaseAdmin
          .from('agent_integrations')
          .insert(payload);
        if (insertErr) {
          console.error(`[AGENT DB WRITE ERROR] Falha ao inserir em agent_integrations:`, insertErr.message);
        } else {
          console.log(`[AGENT DB WRITE] Sucesso: inserido novo registro em agent_integrations para tenant: "${tenantId}"`);
        }
      } else {
        console.log(`[AGENT DB WRITE] Sucesso: upsert em agent_integrations para tenant: "${tenantId}"`);
      }
    }

    // 3. SEMPRE atualizar também na tabela tenants (garantindo sincronia perfeita de leitura)
    try {
      await supabaseAdmin
        .from('tenants')
        .update({ 
          last_ping_at: now,
          updated_at: now
        })
        .eq('id', tenantId);
      console.log(`[AGENT DB WRITE] Sucesso: sincronizado timestamp na tabela tenants para tenant: "${tenantId}"`);
    } catch (tErr: any) {
      console.warn(`[AGENT DB WRITE] Aviso ao atualizar tabela tenants:`, tErr?.message || tErr);
    }
  } catch (err: any) {
    console.error("[Agent Heartbeat Error]:", err.message || err);
  }
}

const normalizeAgentBranchCode = (val: any): string | null => {
  if (val === undefined || val === null) return null;
  const cleaned = String(val).trim();
  return cleaned.length > 0 ? cleaned : null;
};

const resolveTenantAgentSettings = async (
  tenantId: string,
  tenantObj?: any,
  tokenObj?: any,
  reqBody?: any,
): Promise<{ branchCode: string | null; viewName: string | null }> => {
  let integrationRow: { branch_code?: string | null; view_name?: string | null } | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('agent_integrations')
      .select('branch_code, view_name')
      .eq('tenant_id', tenantId)
      .limit(1);
    if (Array.isArray(data) && data.length > 0) {
      integrationRow = data[0];
    }
  } catch (_) {}

  const branchCode =
    normalizeAgentBranchCode(reqBody?.branchCode ?? reqBody?.branch_code) ||
    normalizeAgentBranchCode(tokenObj?.branch_code ?? tokenObj?.branchCode) ||
    normalizeAgentBranchCode(integrationRow?.branch_code) ||
    normalizeAgentBranchCode(tenantObj?.branch_code ?? tenantObj?.branchCode ?? tenantObj?.erp_branch) ||
    normalizeAgentBranchCode(
      tenantObj?.delivery_settings?.branch_code ??
      tenantObj?.delivery_settings?.branchCode ??
      tenantObj?.delivery_settings?.codigo_filial ??
      tenantObj?.delivery_settings?.erp_branch_code,
    ) ||
    null;

  const viewName =
    (integrationRow?.view_name && String(integrationRow.view_name).trim()) ||
    null;

  return { branchCode, viewName };
};

const validateTokenHandler = async (req: express.Request, res: express.Response) => {
  console.log(`\n[DESKTOP AGENT] Recebida requisição de validação em /api/v1/integration/validate-token`);
  try {
    const { token, machineId, machine_id, machine, hostname } = req.body || {};
    const headerMachineId = req.headers['x-machine-id'] || req.headers['machine-id'];
    const mId = machineId || machine_id || machine || hostname || headerMachineId || 'unknown';

    console.log(`[DESKTOP AGENT] Token recebido: "${token ? token.substring(0, 8) + '...' : 'não fornecido'}", Machine ID: "${mId}"`);

    if (!token) {
      return res.status(400).json({ error: "Token não fornecido" });
    }

    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from('activation_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      return res.status(404).json({ error: "Token inválido, inativo ou não encontrado." });
    }

    await supabaseAdmin
      .from('activation_tokens')
      .update({ is_used: true })
      .eq('id', tokenData.id);

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tokenData.tenant_id)
      .maybeSingle();
      
    void touchAgentHeartbeat(tokenData.tenant_id, mId, token, true);

    const erpType = (tenant?.erp_type || 'siagold').toLowerCase().trim();
    const ignorePromotionCampaigns = Boolean(
      (tenant as any)?.ignore_promotion_campaigns === true ||
      tenant?.delivery_settings?.ignore_promotion_campaigns === true
    );
    const { branchCode: resolvedBranchCode, viewName: configuredViewName } = await resolveTenantAgentSettings(
      tokenData.tenant_id,
      tenant,
      tokenData,
      req.body,
    );
    console.log(`[DESKTOP AGENT] Token validado com sucesso para tenant: ${tokenData.tenant_id} (${tenant?.name || 'Farmácia'}, ERP: ${erpType}, branchCode: ${resolvedBranchCode || 'NÃO DEFINIDA'})`);

    let defaultDatabase = "SIAGOLD";
    let defaultPort = 1433;
    let defaultServer = "localhost";
    let defaultUser = "sa";

    if (erpType === "inovafarma" || erpType.includes("inova")) {
      defaultDatabase = "INOVAFARMA";
      defaultPort = 1433;
      defaultServer = "localhost";
      defaultUser = "sa";
    } else if (erpType === "softpharma") {
      defaultDatabase = "SOFTPHARMA";
      defaultPort = 5432;
      defaultServer = "localhost";
      defaultUser = "postgres";
    }

    const defaultViewName = configuredViewName || (erpType === "siagold" ? "vw_FarmaFlow_Itens" : "VW_INTEGRACAO_FARMAFLOW");

    res.json({
      erpType: erpType,
      branchCode: resolvedBranchCode,
      branch_code: resolvedBranchCode,
      ignorePromotionCampaigns,
      ignore_promotion_campaigns: ignorePromotionCampaigns,
      dbConfig: {
        user: defaultUser,
        password: "sua_senha_aqui",
        server: defaultServer,
        port: defaultPort,
        database: defaultDatabase,
        ...(resolvedBranchCode ? { branchCode: resolvedBranchCode } : {}),
        viewName: defaultViewName,
        fallbackViewName: "VW_INTEGRACAO_FARMAFLOW",
        ignorePromotionCampaigns
      },
      syncConfig: {
        batchSize: 200,
        batchDelayMs: 500,
        timeoutMs: 60000,
        maxRetries: 3
      },
      apiKey: tenant?.integration_token || tokenData.tenant_id,
      tenantId: tokenData.tenant_id,
      tenantSlug: tenant?.slug || null
    });
  } catch (error: any) {
    console.error(`[DESKTOP AGENT] Erro interno durante validação do token (500):`, error.message);
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
};

app.all([
  "/api/v1/integration/validate-token",
  "/api/v1/agent/validate-token",
  "/api/agent/validate-token",
  "/api/v1/desktop-agent/validate-token",
  "/api/desktop-agent/validate-token"
], validateTokenHandler);

const handleHeartbeat = async (req: express.Request, res: express.Response) => {
  try {
    const { tenant, tenantId, machineId, activationToken } = await resolveTenantForAgent(req);
    const now = new Date().toISOString();

    if (tenantId) {
      // Dispara atualização no banco em background sem bloquear a resposta HTTP (< 5ms)
      void touchAgentHeartbeat(tenantId, machineId, activationToken, true);
      const ignorePromotionCampaigns = Boolean(
        tenant?.ignore_promotion_campaigns === true ||
        tenant?.delivery_settings?.ignore_promotion_campaigns === true
      );
      const { branchCode: resolvedBranchCode } = await resolveTenantAgentSettings(tenantId, tenant);
      return res.json({ 
        success: true, 
        ok: true,
        tenant_id: tenantId, 
        tenant_name: tenant?.name || null,
        machine_id: machineId || null,
        branch_code: resolvedBranchCode,
        branchCode: resolvedBranchCode,
        ignore_promotion_campaigns: ignorePromotionCampaigns,
        ignorePromotionCampaigns,
        last_seen: now 
      });
    }

    // Fallback: Se não encontrou tenant diretamente mas veio um activation_token direto
    const bodyToken = req.body?.token || req.body?.activation_token || req.query?.token;
    if (bodyToken) {
      const actToken = String(bodyToken).trim();
      const updatePayload: any = {
        last_seen: now,
        is_active: true
      };
      if (machineId && machineId !== 'unknown') {
        updatePayload.machine_id = machineId;
      }

      try {
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('agent_integrations')
          .update(updatePayload)
          .eq('activation_token', actToken)
          .select();

        if (!updateError && updateData && updateData.length > 0) {
          console.log(`[DESKTOP AGENT PING] Heartbeat atualizado pelo activation_token: "${actToken}"`);
          return res.json({ success: true, ok: true, last_seen: now });
        }
      } catch (e) {}
    }

    console.warn(`[DESKTOP AGENT PING REJEITADO] Não foi possível identificar a farmácia na requisição. URL: ${req.originalUrl}, Body:`, req.body);
    return res.status(404).json({ 
      error: "Tenant ou Agente Desktop não identificado. Verifique o Token de Ativação ou a API Key da loja.",
      success: false 
    });
  } catch (error: any) {
    console.error("[DESKTOP AGENT PING EXCEPTION]", error);
    return res.status(500).json({ error: "Erro interno no servidor", details: error.message, success: false });
  }
};

app.all([
  "/api/v1/integration/heartbeat",
  "/api/v1/agent/ping",
  "/api/agent/ping",
  "/api/v1/integration/ping",
  "/api/integration/ping",
  "/api/v1/agent/heartbeat",
  "/api/agent/heartbeat",
  "/api/v1/desktop-agent/heartbeat",
  "/api/v1/desktop-agent/ping",
  "/api/desktop-agent/heartbeat",
  "/api/desktop-agent/ping",
  "/api/v1/agent-desktop/ping",
  "/api/v1/agent-desktop/heartbeat",
  "/api/agent-desktop/ping",
  "/api/agent-desktop/heartbeat",
  "/api/v1/ping",
  "/api/ping"
], handleHeartbeat);

const handleAgentStatus = async (req: express.Request, res: express.Response) => {
  try {
    const filterTenantId = (req.query.tenantId || req.query.tenant_id || req.query.store_id || req.headers['x-tenant-id'] || req.headers['x-store-id']) as string;

    // 1. Busca todos os tenants (ou tenant filtrado) com todos os campos para inspecionar erp_type, smart_banners e last_product_sync
    let tenantsList: any[] = [];
    try {
      let tenantQuery = supabaseAdmin
        .from('tenants')
        .select('*');

      if (filterTenantId) {
        const cleanFilter = filterTenantId.replace(/^store_/, '').replace(/^tenant_/, '').trim();
        tenantQuery = tenantQuery.or(`id.eq.${cleanFilter},slug.eq.${cleanFilter}`);
      }

      const { data, error: tenantsError } = await tenantQuery;
      if (tenantsError) {
        console.warn("[DESKTOP AGENT STATUS] Aviso na consulta de tenants:", tenantsError.message);
      } else {
        tenantsList = data || [];
      }
    } catch (tErr: any) {
      console.warn("[DESKTOP AGENT STATUS] Erro ao buscar tenants:", tErr?.message);
    }

    // 2. Busca todos os registros de agent_integrations
    let agentQuery = supabaseAdmin
      .from('agent_integrations')
      .select('*');

    if (filterTenantId) {
      const cleanFilter = filterTenantId.replace(/^store_/, '').replace(/^tenant_/, '').trim();
      agentQuery = agentQuery.eq('tenant_id', cleanFilter);
    }

    const { data: agentRows } = await agentQuery;

    // Mapa de registros de agent_integrations
    const agentMap = new Map<string, any>();
    if (agentRows) {
      for (const row of agentRows) {
        if (row.tenant_id) {
          agentMap.set(row.tenant_id, row);
        }
      }
    }

    const finalIntegrations: any[] = [];
    const processedTenantIds = new Set<string>();

    const parseDbTimeMs = (val: any): number => {
      if (!val || !String(val).trim()) return NaN;
      let s = String(val).trim();
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
        s = s.replace(/\s+/, 'T');
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
        s = `${s}Z`;
      }
      return new Date(s).getTime();
    };

    const nowMs = Date.now();
    const nowUtcIso = new Date(nowMs).toISOString();

    if (tenantsList && tenantsList.length > 0) {
      for (const t of tenantsList) {
        processedTenantIds.add(t.id);
        const agent = agentMap.get(t.id);
        const erpTypeNorm = String(t.erp_type || '').toLowerCase().trim();
        const isInovafarma =
          erpTypeNorm === 'inovafarma' ||
          String(agent?.machine_id || '').includes('Inovafarma');
        const erpCfg = isInovafarma ? extractTenantErpConfig(t) : null;

        const rawCandidateStrings = [
          agent?.last_seen,
          t.agent_last_seen,
          t.last_seen,
          t.last_ping_at,
          ...(isInovafarma
            ? [
                t.smart_banners?._erpCredentials?.last_seen,
                t.smart_banners?._erpCredentials?.last_product_sync,
                t.last_product_sync,
                erpCfg?.last_product_sync,
                t.smart_banners?._erpCredentials?.updated_at,
              ]
            : []),
        ].filter(Boolean);

        const parsedTimestamps = rawCandidateStrings
          .map((d: any) => parseDbTimeMs(d))
          .filter((n) => !isNaN(n) && n > 0);

        const hasFutureStoredTimestamp = parsedTimestamps.some(
          (n) => n > nowMs + 60000,
        );

        // Ignora timestamps que estejam no futuro (> Date.now() + 60000) para que um registro com fuso errado não esconda o heartbeat real
        const validPastDates = parsedTimestamps.filter((n) => n <= nowMs + 60000);

        // Se havia valor no futuro salvo no banco, corrige imediatamente no banco com new Date().toISOString()
        if (hasFutureStoredTimestamp) {
          if (isInovafarma) {
            touchInovafarmaHeartbeat(supabaseAdmin, t.id, {
              lastProductSync: nowUtcIso,
            }).catch(() => {});
          } else {
            touchAgentHeartbeat(t.id, agent?.machine_id, agent?.activation_token).catch(() => {});
          }
        }

        const latestTimestamp =
          validPastDates.length > 0
            ? new Date(Math.max(...validPastDates)).toISOString()
            : hasFutureStoredTimestamp
              ? nowUtcIso
              : null;

        const rawProdSyncMs = parseDbTimeMs(
          t.smart_banners?._erpCredentials?.last_product_sync ||
            t.last_product_sync ||
            erpCfg?.last_product_sync,
        );
        const safeLastProductSync =
          !isNaN(rawProdSyncMs) && rawProdSyncMs > 0
            ? rawProdSyncMs > nowMs
              ? nowUtcIso
              : new Date(rawProdSyncMs).toISOString()
            : null;

        const hasActiveToken = isInovafarma && erpCfg
          ? Boolean(
              (erpCfg.erp_access_token &&
                isCachedInovafarmaTokenValid(
                  erpCfg.erp_access_token,
                  erpCfg.erp_token_expiration,
                )) ||
                (erpCfg.erp_login && erpCfg.has_erp_password),
            )
          : false;

        finalIntegrations.push({
          id: agent?.id || t.id,
          tenant_id: t.id,
          erp_type: isInovafarma ? 'inovafarma' : erpTypeNorm || null,
          machine_id: isInovafarma
            ? 'API Cloud (Inovafarma)'
            : agent?.machine_id || 'Servidor Local',
          is_active: agent?.is_active ?? true,
          has_active_token: hasActiveToken,
          last_seen: latestTimestamp,
          last_product_sync: safeLastProductSync,
          activation_token: agent?.activation_token || t.integration_token || null,
          tenants: {
            id: t.id,
            name: t.name,
            slug: t.slug,
            erp_type: isInovafarma ? 'inovafarma' : erpTypeNorm || undefined,
            last_product_sync: safeLastProductSync || undefined,
          },
        });
      }
    }

    // Se houver registros em agent_integrations cujo tenant_id não estava na lista de tenants
    if (agentRows) {
      for (const agent of agentRows) {
        if (agent.tenant_id && !processedTenantIds.has(agent.tenant_id)) {
          const isInovaAgent = String(agent.machine_id || '').includes('Inovafarma');
          finalIntegrations.push({
            id: agent.id,
            tenant_id: agent.tenant_id,
            erp_type: isInovaAgent ? 'inovafarma' : null,
            machine_id: isInovaAgent
              ? 'API Cloud (Inovafarma)'
              : agent.machine_id || 'Servidor Local',
            is_active: agent.is_active ?? true,
            last_seen: agent.last_seen || null,
            activation_token: agent.activation_token || null,
            tenants: {
              id: agent.tenant_id,
              name: 'Farmácia',
              ...(isInovaAgent ? { erp_type: 'inovafarma' } : {}),
            },
          });
        }
      }
    }

    console.log(`[DESKTOP AGENT STATUS] Retornando status de ${finalIntegrations.length} integrações/lojas. Filtro: "${filterTenantId || 'todas'}"`);
    return res.json({ data: finalIntegrations });
  } catch (error: any) {
    console.error("[DESKTOP AGENT STATUS ERROR]", error);
    return res.status(500).json({ error: "Erro interno no servidor ao obter status dos agentes", details: error.message });
  }
};

app.all([
  "/api/v1/integration/status",
  "/api/v1/agent/status",
  "/api/v1/desktop-agent/status",
  "/api/desktop-agent/status",
  "/api/integration/status",
  "/api/agent/status"
], handleAgentStatus);

// ============================================================================
// CACHE DE ESTADO NORMALIZADO EM MEMÓRIA POR TENANT_ID PARA DELTA SYNC
// Normaliza null vs 0, strings vazias, códigos internos/EANs e casas decimais (toFixed(2))
// Evita reenvio em massa ("0 inalterados") e preserva o Disk IO Budget do Supabase
// ============================================================================
interface CachedProductDeltaEntry {
  price: string;            // Number(price || 0).toFixed(2)
  promotionalPrice: string; // Number(promo > 0 && promo < price ? promo : 0).toFixed(2)
  originalPrice: string;    // Number(orig > 0 ? orig : 0).toFixed(2)
  stock: number;            // inteiro >= 0
  internalCode: string;     // código interno limpo
  barcode: string;          // código de barras limpo
  name: string;             // nome normalizado (trim + collapse spaces + lowercase)
  hash: string;             // assinatura serializada determinística
}

const tenantProductHashCache = new Map<string, Map<string, CachedProductDeltaEntry>>();

const normalizeDeltaPrice = (val: any): string => {
  if (val === null || val === undefined || val === "") return "0.00";
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return "0.00";
  return n.toFixed(2);
};

const normalizeDeltaPromoPrice = (promoVal: any, sellingPriceVal?: any): string => {
  if (promoVal === null || promoVal === undefined || promoVal === "") return "0.00";
  const promo = Number(promoVal);
  if (!Number.isFinite(promo) || promo <= 0) return "0.00";
  if (sellingPriceVal !== undefined && sellingPriceVal !== null && sellingPriceVal !== "") {
    const sell = Number(sellingPriceVal);
    if (Number.isFinite(sell) && sell > 0 && promo >= sell) {
      return "0.00";
    }
  }
  return promo.toFixed(2);
};

const normalizeDeltaStock = (val: any, isExplicitlyInactive = false): number => {
  if (isExplicitlyInactive) return 0;
  if (val === null || val === undefined || val === "") return 0;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.floor(n));
};

const normalizeDeltaCode = (val: any): string => {
  if (val === null || val === undefined) return "";
  return String(val).trim();
};

const normalizeDeltaCodeNoLeadingZeros = (val: any): string => {
  const s = normalizeDeltaCode(val);
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+/, "") || "0";
  }
  return s;
};

const normalizeDeltaName = (val: any): string => {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\s+/g, " ").toLowerCase();
};

const buildProductDeltaHash = (
  price: any,
  promotionalPrice: any,
  stock: any,
  name: any,
  ignoreErpPrices = false,
  originalPrice?: any,
  internalCode?: any,
): string => {
  const normPrice = ignoreErpPrices ? "IGNORED" : normalizeDeltaPrice(price);
  const normOrigPrice = ignoreErpPrices ? "IGNORED" : normalizeDeltaPrice(originalPrice);
  const normPromo = ignoreErpPrices
    ? "IGNORED"
    : normalizeDeltaPromoPrice(promotionalPrice, price);
  const normStock = normalizeDeltaStock(stock);
  const normCode = normalizeDeltaCodeNoLeadingZeros(internalCode);
  const normName = normalizeDeltaName(name);
  return `${normPrice}|${normOrigPrice}|${normPromo}|${normStock}|${normCode}|${normName}`;
};

const buildCachedProductDeltaEntry = (
  row: any,
  ignoreErpPrices = false,
): CachedProductDeltaEntry => {
  const codeKey = normalizeDeltaCode(row?.internal_code);
  const barcodeKey = normalizeDeltaCode(row?.barcode);
  const normPrice = normalizeDeltaPrice(row?.price);
  const normOrig = normalizeDeltaPrice(row?.original_price);
  const normPromo = normalizeDeltaPromoPrice(row?.promotional_price, row?.price);
  const normStock = normalizeDeltaStock(row?.stock, Boolean(row?._isExplicitlyInactive));
  const normName = normalizeDeltaName(row?.name);

  return {
    price: normPrice,
    promotionalPrice: normPromo,
    originalPrice: normOrig,
    stock: normStock,
    internalCode: codeKey,
    barcode: barcodeKey,
    name: normName,
    hash: buildProductDeltaHash(
      row?.price,
      row?.promotional_price,
      normStock,
      row?.name,
      ignoreErpPrices,
      row?.original_price,
      codeKey,
    ),
  };
};

/**
 * Compara um item recebido do Agente Desktop com o estado já salvo no banco/cache,
 * aplicando exatamente as mesmas regras de resolução de `processProductChunk` e normalizando
 * `null` vs `0`, strings vazias e casas decimais (`Number(...).toFixed(2)`).
 */
const isProductUnchangedInDelta = (
  incomingItem: any,
  cached: CachedProductDeltaEntry,
  ignoreErpPrices = false,
): boolean => {
  if (!incomingItem || !cached) return false;

  // 1. Estoque (inteiro >= 0)
  const effectiveStock = normalizeDeltaStock(
    incomingItem.stock,
    Boolean(incomingItem._isExplicitlyInactive),
  );
  if (effectiveStock !== cached.stock) {
    return false;
  }

  // 2. Preços (quando ignoreErpPrices === false)
  if (!ignoreErpPrices) {
    const incomingOrigNum = Number(incomingItem.original_price) || 0;
    const cachedOrigNum = Number(cached.originalPrice) || 0;
    const effectiveOrigNum = incomingOrigNum > 0 ? incomingOrigNum : cachedOrigNum;

    let effectivePriceNum = Number(incomingItem.price) || 0;
    if (effectivePriceNum <= 0) {
      if (effectiveOrigNum > 0) {
        effectivePriceNum = effectiveOrigNum;
      } else if (Number(cached.price) > 0) {
        effectivePriceNum = Number(cached.price);
      }
    }

    const effectivePrice = normalizeDeltaPrice(effectivePriceNum);
    if (effectivePrice !== cached.price) {
      return false;
    }

    const effectivePromo = normalizeDeltaPromoPrice(
      incomingItem.promotional_price,
      effectivePriceNum,
    );
    if (effectivePromo !== cached.promotionalPrice) {
      return false;
    }

    // Só considera alteração de original_price (PMC) quando o agente enviou um valor > 0 diferente do banco
    // e que não seja apenas o fallback `original_price = price` sobre um banco onde original_price estava 0.00/null
    if (incomingOrigNum > 0) {
      const effectiveOrig = normalizeDeltaPrice(effectiveOrigNum);
      const isFallbackSameAsPrice =
        cached.originalPrice === "0.00" && effectiveOrig === effectivePrice;
      if (!isFallbackSameAsPrice && effectiveOrig !== cached.originalPrice) {
        return false;
      }
    }
  }

  // 3. Código Interno (respeitando preservação de código distinto do EAN e zeros à esquerda)
  const incomingCode = normalizeDeltaCode(incomingItem.internal_code);
  const incomingBarcode = normalizeDeltaCode(incomingItem.barcode);
  const existingCode = cached.internalCode;
  const existingBarcode = cached.barcode;

  let resolvedCode = incomingCode || existingCode;
  if (incomingCode && incomingBarcode && incomingCode !== incomingBarcode) {
    resolvedCode = incomingCode;
  } else if (existingCode && existingBarcode && existingCode !== existingBarcode) {
    resolvedCode = existingCode;
  }

  if (
    resolvedCode &&
    existingCode &&
    normalizeDeltaCodeNoLeadingZeros(resolvedCode) !==
      normalizeDeltaCodeNoLeadingZeros(existingCode)
  ) {
    return false;
  }

  // 4. Nome do produto (normalizado com trim, espaço simples e lowercase; ignora placeholder automático)
  const incomingName = normalizeDeltaName(incomingItem.name);
  const placeholderByEan = incomingBarcode ? normalizeDeltaName(`Produto ${incomingBarcode}`) : "";
  const placeholderByCode = incomingCode ? normalizeDeltaName(`Produto ${incomingCode}`) : "";
  const isPlaceholderName =
    !incomingName ||
    incomingName === placeholderByEan ||
    incomingName === placeholderByCode;

  if (!isPlaceholderName && cached.name && incomingName !== cached.name) {
    return false;
  }

  return true;
};

const setProductEntryInTenantMap = (
  tenantMap: Map<string, CachedProductDeltaEntry>,
  internalCode: string,
  barcode: string,
  entry: CachedProductDeltaEntry,
) => {
  if (internalCode) {
    tenantMap.set(`COD:${internalCode}`, entry);
    tenantMap.set(internalCode, entry);
    const codeNoZeros = normalizeDeltaCodeNoLeadingZeros(internalCode);
    if (codeNoZeros && codeNoZeros !== internalCode) {
      tenantMap.set(`COD:${codeNoZeros}`, entry);
      if (!tenantMap.has(codeNoZeros)) {
        tenantMap.set(codeNoZeros, entry);
      }
    }
  }
  if (barcode) {
    tenantMap.set(`EAN:${barcode}`, entry);
    if (!tenantMap.has(barcode)) {
      tenantMap.set(barcode, entry);
    }
    const bcNoZeros = normalizeDeltaCodeNoLeadingZeros(barcode);
    if (bcNoZeros && bcNoZeros !== barcode) {
      tenantMap.set(`EAN:${bcNoZeros}`, entry);
      if (!tenantMap.has(bcNoZeros)) {
        tenantMap.set(bcNoZeros, entry);
      }
    }
  }
};

const lookupCachedProductDeltaEntry = (
  tenantMap: Map<string, CachedProductDeltaEntry>,
  codeKey: string,
  barcodeKey: string,
): CachedProductDeltaEntry | undefined => {
  if (codeKey) {
    const byCode =
      tenantMap.get(`COD:${codeKey}`) ||
      tenantMap.get(codeKey) ||
      tenantMap.get(`COD:${normalizeDeltaCodeNoLeadingZeros(codeKey)}`);
    if (byCode) return byCode;
  }
  if (barcodeKey) {
    const byBarcode =
      tenantMap.get(`EAN:${barcodeKey}`) ||
      tenantMap.get(barcodeKey) ||
      tenantMap.get(`EAN:${normalizeDeltaCodeNoLeadingZeros(barcodeKey)}`);
    if (byBarcode) return byBarcode;
  }
  return undefined;
};

const updateTenantDeltaCacheWithRows = (
  tenantId: string,
  rows: any[],
  ignoreErpPrices = false,
) => {
  let tenantMap = tenantProductHashCache.get(tenantId);
  if (!tenantMap) {
    tenantMap = new Map<string, CachedProductDeltaEntry>();
    tenantProductHashCache.set(tenantId, tenantMap);
  }

  for (const row of rows) {
    const codeKey = normalizeDeltaCode(row?.internal_code);
    const barcodeKey = normalizeDeltaCode(row?.barcode);
    if (!codeKey && !barcodeKey) continue;

    const entry = buildCachedProductDeltaEntry(row, ignoreErpPrices);
    setProductEntryInTenantMap(tenantMap, codeKey, barcodeKey, entry);
  }
};

const getOrLoadTenantDeltaCache = async (
  tenantId: string,
  ignoreErpPrices = false,
): Promise<Map<string, CachedProductDeltaEntry>> => {
  const existing = tenantProductHashCache.get(tenantId);
  if (existing && existing.size > 0) {
    return existing;
  }

  const tenantMap = new Map<string, CachedProductDeltaEntry>();
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, internal_code, barcode, price, original_price, promotional_price, stock, name")
        .eq("tenant_id", tenantId)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of data) {
        const codeKey = normalizeDeltaCode(row.internal_code);
        const barcodeKey = normalizeDeltaCode(row.barcode);
        if (!codeKey && !barcodeKey) continue;

        const entry = buildCachedProductDeltaEntry(row, ignoreErpPrices);
        setProductEntryInTenantMap(tenantMap, codeKey, barcodeKey, entry);
      }

      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  } catch (err: any) {
    console.warn(
      `[Delta Sync] Aviso ao popular cache em memória do tenant ${tenantId}:`,
      err?.message || err,
    );
  }

  tenantProductHashCache.set(tenantId, tenantMap);
  return tenantMap;
};

// ============================================================================
// REGRAS DE CORREÇÃO DE PREÇO POR FRAÇÃO / EXCEÇÕES POR TENANT E PRODUTO
// ============================================================================
const tenantPriceRulesCache = new Map<
  string,
  { rules: ProductPriceDivisorRule[]; expiresAt: number }
>();
const PRICE_RULES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

const DEFAULT_GLOBAL_PRICE_DIVISOR_RULES: ProductPriceDivisorRule[] = [
  {
    id: "builtin-dryon-fraction-12",
    tenant_id: null,
    name_pattern: "dryon",
    divisor: 12,
    min_raw_price: 45,
    active: true,
  },
];

const getTenantPriceDivisorRules = async (
  tenantId: string,
  tenantObj?: any,
  forceRefresh = false,
): Promise<ProductPriceDivisorRule[]> => {
  const now = Date.now();
  const cached = tenantPriceRulesCache.get(tenantId);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.rules;
  }

  const combinedRules: ProductPriceDivisorRule[] = [
    ...DEFAULT_GLOBAL_PRICE_DIVISOR_RULES,
  ];

  // 1. Regras salvas dentro de delivery_settings.price_divisor_rules do tenant (não exige migração)
  const settingsRules = tenantObj?.delivery_settings?.price_divisor_rules;
  if (Array.isArray(settingsRules)) {
    for (const r of settingsRules) {
      if (r && Number(r.divisor) > 1 && r.active !== false) {
        combinedRules.push({
          id: r.id || undefined,
          tenant_id: tenantId,
          internal_code: r.internal_code || null,
          barcode: r.barcode || r.ean || null,
          name_pattern: r.name_pattern || null,
          divisor: Number(r.divisor),
          min_raw_price:
            r.min_raw_price !== undefined && r.min_raw_price !== null
              ? Number(r.min_raw_price)
              : null,
          active: true,
        });
      }
    }
  }

  // 2. Regras salvas na tabela dedicada `public.product_price_rules` no Supabase (se existir)
  try {
    const { data, error } = await supabaseAdmin
      .from("product_price_rules")
      .select(
        "id, tenant_id, internal_code, barcode, name_pattern, divisor, min_raw_price, active",
      )
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq("active", true);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (Number(row.divisor) > 1) {
          combinedRules.push({
            id: row.id,
            tenant_id: row.tenant_id,
            internal_code: row.internal_code,
            barcode: row.barcode,
            name_pattern: row.name_pattern,
            divisor: Number(row.divisor),
            min_raw_price:
              row.min_raw_price !== null && row.min_raw_price !== undefined
                ? Number(row.min_raw_price)
                : null,
            active: row.active !== false,
          });
        }
      }
    }
  } catch (_err) {
    // Caso a tabela product_price_rules ainda não tenha sido criada no Supabase, segue com as regras em memória/settings
  }

  tenantPriceRulesCache.set(tenantId, {
    rules: combinedRules,
    expiresAt: now + PRICE_RULES_CACHE_TTL_MS,
  });

  return combinedRules;
};

/**
 * Corrige imediatamente na tabela `products` do Supabase os produtos já gravados
 * que se enquadrem nas regras de divisão de preço (ex: Dryon com preço multiplicado por 12).
 */
const applyPriceDivisorRulesToExistingProducts = async (
  targetTenantId?: string,
): Promise<{ correctedCount: number; correctedProducts: any[] }> => {
  const correctedProducts: any[] = [];
  try {
    let customRules: ProductPriceDivisorRule[] = [
      ...DEFAULT_GLOBAL_PRICE_DIVISOR_RULES,
    ];
    if (targetTenantId) {
      customRules = await getTenantPriceDivisorRules(targetTenantId, undefined, true);
    } else {
      try {
        const { data: dbRules } = await supabaseAdmin
          .from("product_price_rules")
          .select(
            "id, tenant_id, internal_code, barcode, name_pattern, divisor, min_raw_price, active",
          )
          .eq("active", true);
        if (Array.isArray(dbRules)) {
          customRules.push(...(dbRules as ProductPriceDivisorRule[]));
        }
      } catch (_e) {}
    }

    let query = supabaseAdmin
      .from("products")
      .select(
        "id, tenant_id, internal_code, barcode, name, manufacturer, presentation, price, original_price, promotional_price",
      )
      .gte("price", 40);

    if (targetTenantId) {
      query = query.eq("tenant_id", targetTenantId);
    }

    const { data: candidates, error } = await query.limit(2000);
    if (error || !Array.isArray(candidates) || candidates.length === 0) {
      return { correctedCount: 0, correctedProducts: [] };
    }

    for (const prod of candidates) {
      const applicableRules = customRules.filter(
        (r) => !r.tenant_id || r.tenant_id === prod.tenant_id,
      );
      const divisor = resolveProductPriceDivisor({
        internalCode: prod.internal_code,
        barcode: prod.barcode,
        name: prod.name,
        manufacturer: prod.manufacturer,
        presentation: prod.presentation,
        rawPriceBruto: prod.price,
        rawPrecoLiquido: prod.promotional_price,
        customRules: applicableRules,
      });

      if (divisor > 1 && Number(prod.price) >= 45) {
        const newPrice = roundCurrency(Number(prod.price) / divisor);
        const newOriginalPrice =
          Number(prod.original_price) > 0
            ? roundCurrency(Number(prod.original_price) / divisor)
            : 0;
        const newPromoPrice =
          prod.promotional_price !== null &&
          prod.promotional_price !== undefined &&
          Number(prod.promotional_price) > 0
            ? roundCurrency(Number(prod.promotional_price) / divisor)
            : null;

        const { error: updateErr } = await supabaseAdmin
          .from("products")
          .update({
            price: newPrice,
            original_price: newOriginalPrice,
            promotional_price: newPromoPrice,
          })
          .eq("id", prod.id);

        if (!updateErr) {
          if (prod.tenant_id) {
            tenantProductHashCache.delete(prod.tenant_id);
          }
          correctedProducts.push({
            id: prod.id,
            tenant_id: prod.tenant_id,
            internal_code: prod.internal_code,
            barcode: prod.barcode,
            name: prod.name,
            old_price: prod.price,
            new_price: newPrice,
            old_promotional_price: prod.promotional_price,
            new_promotional_price: newPromoPrice,
            divisor,
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(
      "[Price Divisor] Aviso ao corrigir produtos existentes:",
      err?.message || err,
    );
  }

  return {
    correctedCount: correctedProducts.length,
    correctedProducts,
  };
};

// Executa uma varredura inicial não-bloqueante ao subir o servidor para corrigir imediatamente produtos Dryon já gravados com preço multiplicado
setTimeout(() => {
  applyPriceDivisorRulesToExistingProducts().then(({ correctedCount }) => {
    if (correctedCount > 0) {
      console.log(
        `[Price Divisor] ${correctedCount} produto(s) com preço multiplicado (ex: Dryon fração 12) corrigidos automaticamente no Supabase.`,
      );
    }
  });
}, 4000);

const normalizedColumnKeyCache = new Map<string, string>();
const normalizeColumnKeyFast = (str: string): string => {
  const cached = normalizedColumnKeyCache.get(str);
  if (cached !== undefined) return cached;
  let s = str;
  if (s.includes('Ã')) {
    try {
      s = decodeURIComponent(escape(str));
    } catch (e) {}
    s = s.replace(/Ã³/g, 'o').replace(/Ã§/g, 'c').replace(/Ã£/g, 'a')
         .replace(/Ã¡/g, 'a').replace(/Ã©/g, 'e')
         .replace(/Ãµ/g, 'o').replace(/Ãº/g, 'u').replace(/Ã¢/g, 'a')
         .replace(/Ãª/g, 'e').replace(/Ã´/g, 'o');
  }
  const normalized = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalizedColumnKeyCache.size < 10000) {
    normalizedColumnKeyCache.set(str, normalized);
  }
  return normalized;
};

const INTERNAL_CODE_NORM_PRIORITY_KEYS = [
  'internalcode', 'codigointerno', 'codinterno',
  'coditem', 'codigoitem', 'cditem', 'iditem',
  'codproduto', 'codigoproduto', 'codprod', 'cdproduto', 'cdprod',
  'idproduto', 'iddoproduto',
  'codigo', 'cod', 'cdigo', 'cdg', 'cd',
  'sku', 'iddosku', 'referencia', 'ref', 'id'
];

const tenantBackgroundSyncActive = new Set<string>();
const tenantPendingNormalizedBatch = new Map<string, { products: any[]; totalReceived: number; ignoreErpPrices: boolean }>();

const handleProductIntegration = async (req: express.Request, res: express.Response) => {
  let tenantId: string | null = null;
  try {
    const syncRequestStartTime = Date.now();
    const { tenant, tenantId: resolvedTenantId, machineId, activationToken } = await resolveTenantForAgent(req);

    if (!tenant || !resolvedTenantId) {
      return res.status(403).json({ error: "API Key inválida ou tenant não encontrado." });
    }

    tenantId = resolvedTenantId;
    const ignoreErpPrices = tenant.ignore_erp_prices === true || tenant.delivery_settings?.ignore_erp_prices === true;
    const tenantPriceRules = await getTenantPriceDivisorRules(tenantId, tenant);
    
    // Atualiza heartbeat do agente em background (não bloqueia a requisição de sync)
    void touchAgentHeartbeat(tenantId, machineId, activationToken);

    let productsBatch = req.body;
    
    if (Array.isArray(productsBatch)) {
      // Já é array
    } else if (productsBatch && Array.isArray(productsBatch.products)) {
        productsBatch = productsBatch.products;
    } else if (productsBatch && Array.isArray(productsBatch.data)) {
        productsBatch = productsBatch.data;
    } else if (productsBatch && Array.isArray(productsBatch.dados)) {
        productsBatch = productsBatch.dados;
    }

    if (!Array.isArray(productsBatch)) {
      return res.status(400).json({ error: "Formato de payload inválido. Esperado array de produtos." });
    }

    let currentProductRef: any = null;
    let currentProductNormMap: Record<string, any> = Object.create(null);
    let currentProductFirstPmc: any = undefined;

    const indexCurrentProduct = (product: any) => {
      currentProductRef = product;
      currentProductNormMap = Object.create(null);
      currentProductFirstPmc = undefined;
      if (!product || typeof product !== 'object') return;
      const keys = Object.keys(product);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const val = product[k];
        if (val === undefined || val === null || val === '') continue;
        if (typeof val === 'string' && val.trim() === '') continue;
        const nk = normalizeColumnKeyFast(k);
        if (nk && currentProductNormMap[nk] === undefined) {
          currentProductNormMap[nk] = val;
        }
        if (currentProductFirstPmc === undefined && nk.includes('pmc')) {
          currentProductFirstPmc = val;
        }
      }
    };

    const getValFromProduct = (product: any, keys: string[]) => {
      if (!product || typeof product !== 'object') return undefined;
      if (product !== currentProductRef) {
        indexCurrentProduct(product);
      }
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const exact = product[k];
        if (exact !== undefined && exact !== null && exact !== '' && (typeof exact !== 'string' || exact.trim() !== '')) {
          return exact;
        }
      }
      for (let i = 0; i < keys.length; i++) {
        const nk = normalizeColumnKeyFast(keys[i]);
        const mapped = currentProductNormMap[nk];
        if (mapped !== undefined) return mapped;
      }
      return undefined;
    };

    const parseAgentNumber = (raw: any, fallback = 0): number => {
      if (raw === null || raw === undefined || raw === '') return fallback;
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback;
      return parseInovafarmaNumber(raw, fallback);
    };

    const isTruthyErpFlag = (val: any): boolean => {
      if (val === true || val === 1) return true;
      if (val === false || val === 0 || val === null || val === undefined) return false;
      const s = String(val)
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return (
        s === "1" ||
        s === "s" ||
        s === "sim" ||
        s === "true" ||
        s === "y" ||
        s === "yes" ||
        s === "ativo" ||
        s === "g" ||
        s === "generico"
      );
    };

    const uniquePayloadMap = new Map<string, any>();
    const internalCodeToKeyMap = new Map<string, string>();
    const barcodeToKeyMap = new Map<string, string>();

    for (let batchIdx = 0; batchIdx < productsBatch.length; batchIdx++) {
       if (batchIdx > 0 && batchIdx % 100 === 0) {
         await new Promise((resolve) => setImmediate(resolve));
       }
       const p = productsBatch[batchIdx];
       indexCurrentProduct(p);

       // 1. EAN / Código de Barras (codigo_barras, EAN, ean, gtin, CodigoBarras, COD_BARRAS, BARRAS)
       const rawEan = getValFromProduct(p, [
         'codigo_barras', 'EAN', 'ean', 'gtin',
         'CodigoBarras', 'COD_BARRAS', 'BARRAS',
         'barcode', 'ean13', 'codigo_barra', 'cod_barra', 'cod_barras', 'codigo_de_barras', 'barras', 'codigo_barra_produto',
         'cd_barras', 'codbarras', 'cdbarras', 'ean_produto'
       ]);
       const cleanedEan = sanitizeInovafarmaEan(rawEan) || (rawEan !== undefined && rawEan !== null ? String(rawEan).trim() : "");

       // 2. Código Interno em O(1) via currentProductNormMap (evita colidir com EAN)
       let internalCode = "";
       let fallbackCodeSameAsEan = "";
       for (let kIdx = 0; kIdx < INTERNAL_CODE_NORM_PRIORITY_KEYS.length; kIdx++) {
         const candidateVal = currentProductNormMap[INTERNAL_CODE_NORM_PRIORITY_KEYS[kIdx]];
         if (candidateVal !== undefined && candidateVal !== null) {
           const cleanCandidate = String(candidateVal).trim();
           if (!cleanCandidate) continue;
           if (cleanedEan && cleanCandidate === cleanedEan) {
             if (!fallbackCodeSameAsEan) fallbackCodeSameAsEan = cleanCandidate;
             continue;
           }
           internalCode = cleanCandidate;
           break;
         }
       }
       if (!internalCode) {
         internalCode = fallbackCodeSameAsEan || cleanedEan;
       }

       const ean = cleanedEan || internalCode;
       if (!ean) continue;
       
       // 6. Estoque e Status Ativo/Inativo (estoque, Estoque_Atual, Qtd_Estoque, Saldo_Estoque, ativo, situacao, status, bloqueado, inativo)
       let stock = Math.floor(parseAgentNumber(getValFromProduct(p, [
         'estoque', 'Estoque_Atual', 'estoque_atual', 'Qtd_Estoque', 'qtd_estoque',
         'Saldo_Estoque', 'saldo_estoque', 'Quantidade_do_estoque', 'quantidade_do_estoque',
         'EstoqueAtual', 'SALDO_ESTOQUE', 'ESTOQUE', 'QTD_ESTOQUE', 'QUANTIDADE',
         'stock', 'estoque_disponivel', 'saldo', 'quantidade', 'qtd', 'quantidade_estoque', 'quant'
       ]), 0));
       if (isNaN(stock) || stock < 0) stock = 0;

       const rawBlockedFlag = getValFromProduct(p, ['bloqueado', 'Bloqueado', 'BLOQUEADO', 'inativo', 'Inativo', 'INATIVO', 'excluido', 'Excluido']);
       const rawActiveFlag = getValFromProduct(p, ['active', 'ativo', 'Ativo', 'ATIVO', 'situacao', 'Situacao', 'SITUACAO', 'status', 'Status', 'STATUS']);

       const isExplicitlyBlocked =
         rawBlockedFlag === true ||
         rawBlockedFlag === 1 ||
         ['1', 'S', 'SIM', 'TRUE', 'Y', 'YES', 'BLOQUEADO', 'INATIVO'].includes(String(rawBlockedFlag ?? '').trim().toUpperCase());

       const isExplicitlyDeactivated =
         rawActiveFlag === false ||
         rawActiveFlag === 0 ||
         ['0', 'N', 'NAO', 'NÃO', 'FALSE', 'I', 'INATIVO', 'B', 'BLOQUEADO', 'C', 'CANCELADO', 'D', 'DESATIVADO', 'E', 'EXCLUIDO'].includes(
           String(rawActiveFlag ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
         );

       const isExplicitlyInactive = isExplicitlyBlocked || isExplicitlyDeactivated;
       if (isExplicitlyInactive) {
         stock = 0;
       }
       
       // 3. Nome/Descrição, Fabricante, Apresentação, Unidade e Fração (extraídos antes do preço para aplicar regras de divisão de fração)
       const rawName = getValFromProduct(p, [
         'descricao_produto', 'nome', 'Nome_do_Produto', 'nome_do_produto', 'Nome_do_Sku', 'nome_do_sku',
         'NomeProduto', 'DESCRICAO', 'NOME', 'PRODUTO', 'APRESENTACAO',
         'name', 'descricao', 'nome_produto', 'produto',
         'descrio', 'descr', 'title'
       ]);
       const name = rawName !== undefined && rawName !== null ? String(rawName).trim() : `Produto ${ean}`;

       const rawManufacturer = getValFromProduct(p, [
         'fabricante', 'laboratorio', 'Marca', 'marca',
         'NomeFabricante', 'FABRICANTE', 'LABORATORIO', 'NOME_FABRICANTE', 'MARCA',
         'manufacturer', 'nome_fabricante'
       ]);
       const rawPresentation = getValFromProduct(p, [
         'APRESENTACAO', 'presentation', 'apresentacao', 'embalagem', 'unidade_medida', 'unidadeMedida', 'unidade'
       ]);
       const rawUnit = getValFromProduct(p, [
         'unidade', 'Unidade', 'UNIDADE', 'unidade_medida', 'Unidade_Medida', 'UNIDADEMEDIDA', 'und', 'UND', 'un'
       ]);
       const rawFraction = parseAgentNumber(getValFromProduct(p, [
         'fracao', 'Fracao', 'FRACAO', 'qtd_embalagem', 'Qtd_Embalagem', 'QTD_EMBALAGEM',
         'quantidade_embalagem', 'Quantidade_Embalagem', 'fator_conversao', 'Fator_Conversao',
         'multiplo', 'Multiplo', 'embalagem_venda'
       ]), 0);
       const rawExplicitDivisor = parseAgentNumber(getValFromProduct(p, [
         'divisor_preco', 'price_divisor', 'divisorPreco', 'priceDivisor'
       ]), 0);

       // 4. Preço de Venda (preco, preco_venda, Preco_Bruto; se vier <= 0 ou nulo, usa Preco_Liquido ou preco_original / PMC)
       let rawPriceBruto = parseAgentNumber(getValFromProduct(p, [
         'preco', 'preco_venda', 'Preco_Bruto', 'preco_bruto', 'PrecoBruto', 'PRECO_BRUTO',
         'PrecoVenda', 'PRECO_VENDA', 'PRECO', 'VALOR', 'Vl_Venda', 'vl_venda', 'Vlr_Venda', 'vlr_venda',
         'price', 'preco_por', 'preco_unitario', 'valor', 'valor_venda', 'venda', 'preco_venda_unitario', 'MENORPRECOVENDA', 'menor_preco_venda'
       ]), 0);
       if (isNaN(rawPriceBruto) || rawPriceBruto < 0) rawPriceBruto = 0;

       let rawPrecoLiquidoFallback = parseAgentNumber(getValFromProduct(p, [
         'Preco_Liquido', 'preco_liquido', 'PrecoLiquido', 'PRECO_LIQUIDO', 'PRECO_LIQUido', 'Vl_Liquido', 'vl_liquido'
       ]), 0);
       if (isNaN(rawPrecoLiquidoFallback) || rawPrecoLiquidoFallback < 0) rawPrecoLiquidoFallback = 0;

       let originalPrice = parseAgentNumber(getValFromProduct(p, [
         'original_price', 'originalPrice', 'preco_original', 'Preco_Original', 'PRECO_ORIGINAL', 'PrecoOriginal',
         'Vl_PMC', 'vl_pmc', 'VL_PMC', 'Vl. PMC', 'VlPMC', 'vlpmc',
         'Valor_PMC', 'valor_pmc', 'VALOR_PMC', 'Vlr_PMC', 'vlr_pmc', 'VLR_PMC', 'Vlr. PMC',
         'Preco_PMC', 'preco_pmc', 'PRECO_PMC', 'PrecoPmc', 'Pr_PMC', 'pr_pmc',
         'pmc', 'PMC', 'Preco_Consumidor', 'preco_consumidor', 'Vl_Consumidor', 'vl_consumidor',
         'Preco_Maximo', 'preco_maximo', 'Vl_Tabela', 'vl_tabela', 'Preco_Tabela', 'preco_tabela', 'PRECO_TABELA',
         'Preco_Fabrica', 'preco_fabrica', 'Pr_Fabrica', 'pr_fabrica',
         'preco_de', 'preco_cadastro', 'preco_antigo', 'valor_original', 'preco_cheio'
       ]), 0);

       // Fallback O(1): usa currentProductFirstPmc já capturado no indexCurrentProduct
       if (isNaN(originalPrice) || originalPrice <= 0) {
         originalPrice = currentProductFirstPmc !== undefined ? parseAgentNumber(currentProductFirstPmc, 0) : 0;
         if (isNaN(originalPrice) || originalPrice < 0) originalPrice = 0;
       }

       // 5. Preço Promocional bruto antes da validação
       let rawPromoPrice = parseAgentNumber(getValFromProduct(p, [
         'preco_promocional', 'Preco_Liquido', 'preco_liquido', 'PrecoLiquido',
         'PrecoPromocao', 'PRECO_PROMOCAO', 'PRECO_DESCONTO', 'PRECO_LIQUido', 'PRECO_LIQUIDO', 'VL_PROMOCAO',
         'promotional_price', 'promotionalPrice', 'promo_price', 'preco_promo', 'promocional', 'valor_promocional', 'preco_oferta', 'vl_promo', 'preco_por', 'preco_vitrine'
       ]), 0);
       if (isNaN(rawPromoPrice) || rawPromoPrice < 0) rawPromoPrice = 0;

       let rawProgPrice = parseAgentNumber(getValFromProduct(p, [
         'promo_progressive_price', 'preco_atacado', 'preco_progressivo', 'valor_atacado', 'vl_atacado', 'promoProgressivePrice'
       ]), 0);
       if (isNaN(rawProgPrice) || rawProgPrice < 0) rawProgPrice = 0;

       // Regra de correção automática de preço por fração / exceção (ex: Dryon com fração 12 ou regras por produto/tenant)
       const priceDivisor = resolveProductPriceDivisor({
         internalCode,
         barcode: ean,
         name,
         manufacturer: rawManufacturer ? String(rawManufacturer) : null,
         unit: rawUnit ? String(rawUnit) : null,
         presentation: rawPresentation ? String(rawPresentation) : null,
         rawFraction,
         explicitDivisor: rawExplicitDivisor,
         rawPriceBruto: rawPriceBruto > 0 ? rawPriceBruto : originalPrice,
         rawPrecoLiquido: rawPrecoLiquidoFallback > 0 ? rawPrecoLiquidoFallback : rawPromoPrice,
         customRules: tenantPriceRules,
       });

       if (priceDivisor > 1) {
         if (rawPriceBruto > 0) rawPriceBruto = roundCurrency(rawPriceBruto / priceDivisor);
         if (rawPrecoLiquidoFallback > 0) rawPrecoLiquidoFallback = roundCurrency(rawPrecoLiquidoFallback / priceDivisor);
         if (originalPrice > 0) originalPrice = roundCurrency(originalPrice / priceDivisor);
         if (rawPromoPrice > 0) rawPromoPrice = roundCurrency(rawPromoPrice / priceDivisor);
         if (rawProgPrice > 0) rawProgPrice = roundCurrency(rawProgPrice / priceDivisor);
       }

       // Regra de Fallback Inteligente de Preço (Siagold / ERP):
       // Se preco_venda (rawPriceBruto / rawPrecoLiquidoFallback) for nulo, indefinido ou <= 0,
       // assume automaticamente o valor de preco_original (PMC/tabela) como o preco_venda principal
       let price =
         rawPriceBruto > 0
           ? rawPriceBruto
           : rawPrecoLiquidoFallback > 0
             ? rawPrecoLiquidoFallback
             : originalPrice > 0
               ? originalPrice
               : rawPromoPrice > 0
                 ? rawPromoPrice
                 : 0;

       // Normalização e extração de colunas de promoção do ERP (com retrocompatibilidade total)
       const rawStartDate = getValFromProduct(p, [
         'promo_start_date', 'promo_data_inicio', 'data_inicio_promo', 'dt_inicio_promo', 'inicio_promo', 'data_inicio', 'promo_start'
       ]);
       const rawEndDate = getValFromProduct(p, [
         'promo_end_date', 'promo_data_fim', 'data_fim_promo', 'dt_fim_promo', 'fim_promo', 'data_fim', 'promo_end'
       ]);

       let isPromoValid = true;
       const now = new Date();
       if (rawStartDate) {
         const sDate = new Date(rawStartDate);
         if (!isNaN(sDate.getTime()) && now < sDate) isPromoValid = false;
       }
       if (rawEndDate) {
         let eDate = new Date(rawEndDate);
         if (typeof rawEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawEndDate.trim())) {
           eDate = new Date(`${rawEndDate.trim()}T23:59:59.999Z`);
         }
         if (!isNaN(eDate.getTime()) && now > eDate) isPromoValid = false;
       }

       const promoPrice = (!isNaN(rawPromoPrice) && rawPromoPrice > 0 && rawPromoPrice < price && isPromoValid) ? rawPromoPrice : null;

       const rawBuyQty = parseAgentNumber(getValFromProduct(p, [
         'promo_buy_qty', 'promo_qtd_minima', 'qtd_leve', 'leve_x', 'qtd_minima', 'qtd_min', 'buy_x', 'buyX', 'promoBuyQty'
       ]), 0);
       const buyQty = (!isNaN(rawBuyQty) && rawBuyQty > 0 && isPromoValid) ? Math.floor(rawBuyQty) : null;

       const rawPayQty = parseAgentNumber(getValFromProduct(p, [
         'promo_pay_qty', 'promo_qtd_paga', 'qtd_pague', 'pague_y', 'pay_y', 'payY', 'promoPayQty'
       ]), 0);
       const payQty = (!isNaN(rawPayQty) && rawPayQty > 0 && isPromoValid) ? Math.floor(rawPayQty) : null;

       const progPrice = (!isNaN(rawProgPrice) && rawProgPrice > 0 && isPromoValid) ? rawProgPrice : null;

       const rawPromoType = getValFromProduct(p, [
         'promo_type', 'tipo_regra_promo', 'tipo_promo', 'regra_promo', 'tipo_promocao', 'promotionType', 'promoType'
       ]);

       let promoType: 'none' | 'simple' | 'buy_x_pay_y' | 'progressive' = 'none';
       if (rawPromoType && isPromoValid) {
         const s = String(rawPromoType).toLowerCase().trim();
         if (s.includes('leve') || s.includes('buy_x') || s.includes('kit') || s === 'buy_x_pay_y') {
           promoType = 'buy_x_pay_y';
         } else if (s.includes('progress') || s.includes('atacado') || s === 'progressive' || s.includes('qtd')) {
           promoType = 'progressive';
         } else if (s.includes('simple') || s.includes('simples') || s.includes('desconto') || s.includes('de_por') || s === 'discount') {
           promoType = 'simple';
         }
       }

       if (promoType === 'none' && isPromoValid) {
         if (buyQty && payQty && buyQty > payQty) {
           promoType = 'buy_x_pay_y';
         } else if (progPrice && buyQty && buyQty > 1) {
           promoType = 'progressive';
         } else if (promoPrice && price > 0 && promoPrice < price) {
           promoType = 'simple';
         }
       }

       let dbPromotionType = 'NONE';
       let dbBuyX: number | null = null;
       let dbPayY: number | null = null;
       let dbDiscountThreshold: number | null = null;
       let dbDiscountPercentage: number | null = null;
       let finalPromotionalPrice: number | null = null;

       if (promoType === 'buy_x_pay_y' && buyQty && payQty && buyQty > payQty) {
         dbPromotionType = 'BUY_X_PAY_Y';
         dbBuyX = buyQty;
         dbPayY = payQty;
       } else if (promoType === 'progressive' && buyQty && progPrice) {
         dbPromotionType = 'DISCOUNT_ON_QTY';
         dbDiscountThreshold = buyQty;
         finalPromotionalPrice = progPrice;
         if (price > 0 && progPrice < price) {
           dbDiscountPercentage = Number((((price - progPrice) / price) * 100).toFixed(2));
         }
       } else if (promoType === 'simple' && promoPrice && price > 0 && promoPrice < price) {
         dbPromotionType = 'DISCOUNT';
         finalPromotionalPrice = promoPrice;
       }

       const promotionalPrice = finalPromotionalPrice;

       // 8. Departamento / Grupo / Seção (NomeGrupo, GRUPO, SECAO, DEPARTAMENTO, CATEGORIA, SUBGRUPO)
       const rawCategory = getValFromProduct(p, [
         'NomeGrupo', 'GRUPO', 'SECAO', 'DEPARTAMENTO', 'CATEGORIA', 'SUBGRUPO',
         'category', 'categoria', 'secao', 'grupo', 'departamento', 'subgrupo', 'nome_grupo', 'grupo_produto', 'nome_secao', 'nome_departamento', 'classe', 'subcategoria', 'familia', 'depto'
       ]);
       const rawActivePrinciple = getValFromProduct(p, [
         'active_principle', 'activePrinciple', 'principio_ativo', 'principioAtivo', 'substancia', 'formula'
       ]);
       const rawDescription = getValFromProduct(p, [
         'Descricao', 'apresentacao', 'description', 'descricao_longa', 'detalhes', 'APRESENTACAO', 'Apresentacao'
       ]);

       // 9. Classificação / Genérico / Receita (Classificacao, TIPO, GENERICO, LISTA_PBM, PSICOTROPICO, RETENCAO_RECEITA)
       const rawClassificacao = getValFromProduct(p, [
         'Classificacao', 'CLASSIFICACAO', 'TIPO', 'drug_type', 'drugType', 'tipo', 'tipo_produto', 'classe_terapeutica'
       ]);
       const rawGenerico = getValFromProduct(p, [
         'GENERICO', 'Generico', 'generico', 'eh_generico', 'is_generic'
       ]);
       const rawListaPbm = getValFromProduct(p, [
         'LISTA_PBM', 'ListaPbm', 'lista_pbm', 'pbm'
       ]);
       const rawPsicotropico = getValFromProduct(p, [
         'PSICOTROPICO', 'Psicotropico', 'psicotropico', 'controlado', 'portaria_344'
       ]);
       const rawRetencaoReceita = getValFromProduct(p, [
         'RETENCAO_RECEITA', 'RetencaoReceita', 'retencao_receita', 'requires_prescription', 'exige_receita', 'receita'
       ]);

       const normClassStr = String(rawClassificacao || '')
         .toLowerCase()
         .normalize("NFD")
         .replace(/[\u0300-\u036f]/g, "")
         .trim();

       let resolvedDrugType = rawClassificacao ? String(rawClassificacao).trim() : '';
       if (isTruthyErpFlag(rawGenerico) || normClassStr.includes('generico') || normClassStr === 'g') {
         resolvedDrugType = 'Genérico';
       } else if (normClassStr.includes('similar') || normClassStr === 's') {
         resolvedDrugType = 'Similar';
       } else if (normClassStr.includes('referencia') || normClassStr.includes('etico') || normClassStr === 'r') {
         resolvedDrugType = 'Referência';
       }

       const requiresPrescription =
         isTruthyErpFlag(rawPsicotropico) ||
         isTruthyErpFlag(rawRetencaoReceita) ||
         normClassStr.includes('psicotropico') ||
         normClassStr.includes('controlado') ||
         normClassStr.includes('retencao') ||
         normClassStr.includes('tarja preta') ||
         normClassStr.includes('antimicrobiano');

       // Motor Inteligente de Autocategorização (8 prioridades estritas sobre nome e fabricante)
       const strictCategoryRes = classifyProductCategory(
         name,
         rawManufacturer ? String(rawManufacturer) : "",
         rawCategory ? String(rawCategory) : "",
       );

       let finalSubcategory = strictCategoryRes.subcategory;
       let finalDepartment = strictCategoryRes.department;

       if (
         strictCategoryRes.priority === 8 &&
         strictCategoryRes.subcategory === "Outros Medicamentos"
       ) {
         const classified = classifyProductTaxonomy({
           name: name,
           activePrinciple: rawActivePrinciple,
           description: rawDescription,
           rawCategory: rawCategory,
           drugType: resolvedDrugType || rawClassificacao,
           manufacturer: rawManufacturer,
         });
         finalSubcategory = classified.subcategory;
         finalDepartment = classified.department;
       }

       const pbmClean = rawListaPbm !== undefined && rawListaPbm !== null ? String(rawListaPbm).trim() : '';
       const hasValidPbm = Boolean(pbmClean && !['0', 'n', 'nao', 'não', 'false'].includes(pbmClean.toLowerCase()));
       const finalDescription = [
         rawDescription ? String(rawDescription).trim() : '',
         hasValidPbm ? `Lista PBM: ${pbmClean}` : '',
         requiresPrescription ? 'Medicamento sob retenção de receita / controle especial' : ''
       ].filter(Boolean).join(' | ') || undefined;

       const rawImage = getValFromProduct(p, [
         'image', 'imagem', 'foto', 'url_imagem', 'url_foto', 'imagem_url', 'img'
       ]);
       const image = (rawImage !== undefined && rawImage !== null && String(rawImage).trim().length > 0) ? String(rawImage).trim() : null;

       const resolvedInternalCode = internalCode || ean;
       const resolvedBarcode = ean;

       // Desduplicação estrita por internal_code E barcode para evitar erro ON CONFLICT DO UPDATE no PostgreSQL
       const existingKeyByCode = resolvedInternalCode ? internalCodeToKeyMap.get(resolvedInternalCode) : undefined;
       const existingKeyByBarcode = resolvedBarcode ? barcodeToKeyMap.get(resolvedBarcode) : undefined;

       if (existingKeyByCode && existingKeyByBarcode && existingKeyByCode !== existingKeyByBarcode) {
         uniquePayloadMap.delete(existingKeyByBarcode);
       }

       const dedupKey = existingKeyByCode || existingKeyByBarcode || (internalCode ? `COD:${internalCode}` : `EAN:${ean}`);
       if (resolvedInternalCode) internalCodeToKeyMap.set(resolvedInternalCode, dedupKey);
       if (resolvedBarcode) barcodeToKeyMap.set(resolvedBarcode, dedupKey);

       uniquePayloadMap.set(dedupKey, {
          tenant_id: tenantId,
          barcode: resolvedBarcode,
          internal_code: resolvedInternalCode,
          stock,
          _isExplicitlyInactive: isExplicitlyInactive,
          price,
          is_featured: (Number(price) <= 0 || isNaN(Number(price))) ? false : undefined,
          original_price: originalPrice,
          promotional_price: promotionalPrice,
          promo_type: promoType,
          promo_buy_qty: buyQty,
          promo_pay_qty: payQty,
          promo_progressive_price: progPrice,
          promo_start_date: rawStartDate ? String(rawStartDate) : null,
          promo_end_date: rawEndDate ? String(rawEndDate) : null,
          promotion_type: dbPromotionType,
          buy_x: dbBuyX,
          pay_y: dbPayY,
          discount_qty_threshold: dbDiscountThreshold,
          discount_qty_percentage: dbDiscountPercentage,
          image: image,
          name: name,
          category: finalSubcategory,
          department: finalDepartment,
          active_principle: rawActivePrinciple ? String(rawActivePrinciple).trim() : null,
          manufacturer: rawManufacturer ? String(rawManufacturer).trim() : null,
          presentation: rawPresentation ? String(rawPresentation).trim() : null,
          ...(finalDescription ? { description: finalDescription } : {}),
          requires_prescription: requiresPrescription,
          drug_type: resolvedDrugType || (finalDepartment === "Medicamentos" ? "Outros" : "Cosmético")
       });
     }

    const allNormalizedProducts = Array.from(uniquePayloadMap.values());

    if (allNormalizedProducts.length === 0) {
      return res.status(200).json({
        success: true,
        totalReceived: productsBatch.length,
        upserted: 0,
        processed: 0,
        message: "Nenhum produto válido encontrado no lote.",
      });
    }

    // Garante que nenhum lote enviado ao Supabase tenha chaves duplicadas para a constraint usada no ON CONFLICT
    const deduplicateByConflictField = (rows: any[], field: 'id' | 'internal_code' | 'barcode') => {
      const map = new Map<string, any>();
      for (const row of rows) {
        const keyVal = row[field] ? String(row[field]).trim() : '';
        if (!keyVal) continue;
        map.set(keyVal, row);
      }
      return Array.from(map.values());
    };

    const processProductChunk = async (chunk: any[], targetTenantId: string, targetIgnoreErpPrices: boolean) => {
      const barcodes = Array.from(new Set(chunk.map(p => p.barcode).filter(Boolean)));
      const internalCodes = Array.from(new Set(chunk.map(p => p.internal_code).filter(Boolean)));

      const [{ data: existingByBc }, { data: existingByCode }] = await Promise.all([
        barcodes.length > 0
          ? supabaseAdmin.from('products').select('*').eq('tenant_id', targetTenantId).in('barcode', barcodes)
          : Promise.resolve({ data: [] as any[] }),
        internalCodes.length > 0
          ? supabaseAdmin.from('products').select('*').eq('tenant_id', targetTenantId).in('internal_code', internalCodes)
          : Promise.resolve({ data: [] as any[] }),
      ]);
        
      const existingMap = new Map();
      const existingInternalMap = new Map();
      for (const p of [...(existingByBc || []), ...(existingByCode || [])]) {
        if (p.barcode) existingMap.set(String(p.barcode).trim(), p);
        if (p.internal_code) existingInternalMap.set(String(p.internal_code).trim(), p);
      }

      // Regra de Ouro: Se produto novo (e com estoque > 0) vier sem foto mas tiver barcode, busca se já existe foto para aquele barcode em outra loja no Supabase
      const newBarcodesNeedingImage = chunk
        .filter(item =>
          !existingMap.has(item.barcode) &&
          !existingInternalMap.has(item.internal_code) &&
          Number(item.stock) > 0 &&
          !item._isExplicitlyInactive &&
          (!item.image || String(item.image).trim().length === 0)
        )
        .map(item => item.barcode);

      const crossStoreImageMap = new Map<string, string>();
      if (newBarcodesNeedingImage.length > 0) {
        try {
          const { data: siblingProducts } = await supabaseAdmin
            .from('products')
            .select('barcode, image')
            .in('barcode', newBarcodesNeedingImage)
            .not('image', 'is', null)
            .neq('image', '')
            .limit(newBarcodesNeedingImage.length * 2);

          if (siblingProducts && siblingProducts.length > 0) {
            siblingProducts.forEach((sp: any) => {
              if (
                sp.barcode &&
                sp.image &&
                !isPlaceholderImageUrl(sp.image) &&
                !crossStoreImageMap.has(sp.barcode)
              ) {
                crossStoreImageMap.set(sp.barcode, sp.image);
              }
            });
          }
        } catch (siblingImgErr: any) {
          console.warn("[Integration] Aviso ao buscar foto de barcode em outra drogaria:", siblingImgErr?.message);
        }
      }

      const newProductsPayload: any[] = [];
      const existingProductsPayload: any[] = [];
      const unchangedExistingRowsForCache: any[] = [];
      let chunkIgnoredNewZeroStock = 0;
      let chunkUnchangedEqualityCount = 0;
      let chunkIgnoredByErpPricesCount = 0;

      chunk.forEach(rawItem => {
         const { _isExplicitlyInactive, ...item } = rawItem;
         const itemCodeClean = normalizeDeltaCode(item.internal_code);
         const itemCodeNoZeros = normalizeDeltaCodeNoLeadingZeros(item.internal_code);
         const itemBcClean = normalizeDeltaCode(item.barcode);
         const existing =
           (itemCodeClean && (existingInternalMap.get(itemCodeClean) || existingInternalMap.get(itemCodeNoZeros))) ||
           (itemBcClean && existingMap.get(itemBcClean));
         if (existing) {
            // Produto JÁ EXISTE no banco do tenant: faz UPDATE apenas se houver alteração real após normalização
            let finalPrice = item.price;
            let finalOriginalPrice = Number(item.original_price) > 0
              ? Number(item.original_price)
              : (Number(existing.original_price) > 0 ? Number(existing.original_price) : 0);
            let finalPromotionalPrice = item.promotional_price;
            let finalPromotionType = item.promotion_type;
            let finalBuyX = item.buy_x;
            let finalPayY = item.pay_y;
            let finalDiscountThreshold = item.discount_qty_threshold;
            let finalDiscountPercentage = item.discount_qty_percentage;
            let finalPromoType = item.promo_type;
            let finalPromoBuyQty = item.promo_buy_qty;
            let finalPromoPayQty = item.promo_pay_qty;
            let finalPromoProgressivePrice = item.promo_progressive_price;
            let finalPromoStartDate = item.promo_start_date;
            let finalPromoEndDate = item.promo_end_date;
            
            if (targetIgnoreErpPrices) {
               finalPrice = existing.price;
               finalOriginalPrice = Number(existing.original_price) > 0
                 ? Number(existing.original_price)
                 : (Number(item.original_price) > 0 ? Number(item.original_price) : 0);
               finalPromotionalPrice = existing.promotional_price;
               finalPromotionType = existing.promotion_type;
               finalBuyX = existing.buy_x;
               finalPayY = existing.pay_y;
               finalDiscountThreshold = existing.discount_qty_threshold;
               finalDiscountPercentage = existing.discount_qty_percentage;
               finalPromoType = existing.promo_type;
               finalPromoBuyQty = existing.promo_buy_qty;
               finalPromoPayQty = existing.promo_pay_qty;
               finalPromoProgressivePrice = existing.promo_progressive_price;
               finalPromoStartDate = existing.promo_start_date;
               finalPromoEndDate = existing.promo_end_date;
            } else {
               // Fallback adicional na atualização: se finalPrice <= 0, assume finalOriginalPrice ou preserva o preço válido já cadastrado
               if (Number(finalPrice) <= 0 || isNaN(Number(finalPrice))) {
                 if (Number(finalOriginalPrice) > 0) {
                   finalPrice = Number(finalOriginalPrice);
                 } else if (Number(existing.price) > 0) {
                   finalPrice = Number(existing.price);
                 } else if (Number(existing.original_price) > 0) {
                   finalPrice = Number(existing.original_price);
                 }
               }
            }
            
            const finalImage = (item.image && typeof item.image === 'string' && item.image.trim().length > 0)
              ? item.image.trim()
              : existing.image;

            const isManuallyCategorized =
              existing.is_manual_category === true || existing.manual_category === true;

            const finalCategory = isManuallyCategorized
              ? existing.category
              : (item.category || existing.category);
            const finalDepartment = isManuallyCategorized
              ? existing.department
              : (item.department || existing.department);

            const isZeroPrice = Number(finalPrice) <= 0 || isNaN(Number(finalPrice));
            const updatedStock = _isExplicitlyInactive ? 0 : Math.max(0, Math.floor(Number(item.stock) || 0));

            // Resolução inteligente de internal_code:
            // Se o agente enviou um código interno real diferente do barcode (ex: '20325'), atualiza o banco (corrigindo itens que estavam com internal_code === barcode).
            const incomingCode = item.internal_code ? String(item.internal_code).trim() : '';
            const incomingBarcode = item.barcode ? String(item.barcode).trim() : '';
            const existingCode = existing.internal_code ? String(existing.internal_code).trim() : '';
            const existingBarcode = existing.barcode ? String(existing.barcode).trim() : '';

            let resolvedUpdatedInternalCode = incomingCode || existingCode;
            if (incomingCode && incomingBarcode && incomingCode !== incomingBarcode) {
              resolvedUpdatedInternalCode = incomingCode;
            } else if (existingCode && existingBarcode && existingCode !== existingBarcode) {
              resolvedUpdatedInternalCode = existingCode;
            }

            const mergedRow = {
               ...existing,
               name: item.name || existing.name,
               barcode: item.barcode || existing.barcode,
               category: finalCategory,
               department: finalDepartment,
               internal_code: resolvedUpdatedInternalCode,
               manufacturer: item.manufacturer || existing.manufacturer,
               presentation: item.presentation || existing.presentation,
               drug_type: (item.drug_type && item.drug_type !== 'Outros') ? item.drug_type : (existing.drug_type || item.drug_type),
               requires_prescription: item.requires_prescription || existing.requires_prescription || false,
               stock: updatedStock,
               price: finalPrice,
               is_featured: isZeroPrice ? false : existing.is_featured,
               original_price: finalOriginalPrice,
               promotional_price: finalPromotionalPrice,
               promo_type: finalPromoType,
               promo_buy_qty: finalPromoBuyQty,
               promo_pay_qty: finalPromoPayQty,
               promo_progressive_price: finalPromoProgressivePrice,
               promo_start_date: finalPromoStartDate,
               promo_end_date: finalPromoEndDate,
               promotion_type: finalPromotionType,
               buy_x: finalBuyX,
               pay_y: finalPayY,
               discount_qty_threshold: finalDiscountThreshold,
               discount_qty_percentage: finalDiscountPercentage,
               image: finalImage
            };

            const existingCachedState = buildCachedProductDeltaEntry(existing, targetIgnoreErpPrices);
            const isSameCoreFields = isProductUnchangedInDelta(
              { ...mergedRow, _isExplicitlyInactive },
              existingCachedState,
              targetIgnoreErpPrices,
            );
            const isSamePromoRule =
              String(finalPromotionType || "NONE").toUpperCase() ===
                String(existing.promotion_type || "NONE").toUpperCase() &&
              (Number(finalBuyX) || 0) === (Number(existing.buy_x) || 0) &&
              (Number(finalPayY) || 0) === (Number(existing.pay_y) || 0) &&
              (Number(finalDiscountThreshold) || 0) === (Number(existing.discount_qty_threshold) || 0);

            if (isSameCoreFields && isSamePromoRule) {
              unchangedExistingRowsForCache.push(mergedRow);
              if (targetIgnoreErpPrices && !isProductUnchangedInDelta({ ...item, _isExplicitlyInactive }, buildCachedProductDeltaEntry(existing, false), false)) {
                chunkIgnoredByErpPricesCount++;
              } else {
                chunkUnchangedEqualityCount++;
              }
            } else {
              existingProductsPayload.push(mergedRow);
            }
         } else {
            // Proteção Definitiva no Banco:
            // Se o produto NÃO EXISTIR no banco do tenant (seria um INSERT de produto novo)
            // e estiver com stock <= 0 ou inativo, IGNORA a criação desse produto!
            if (Number(item.stock) <= 0 || _isExplicitlyInactive) {
              chunkIgnoredNewZeroStock++;
              return;
            }

            const isNewZeroPrice = Number(item.price) <= 0 || isNaN(Number(item.price));
            if (isNewZeroPrice && (Number(item.original_price) <= 0 || isNaN(Number(item.original_price)))) {
              chunkIgnoredNewZeroStock++;
              return;
            }

            const isGenItem = isGenericMedicationProduct(item);
            const finalImage = (item.image && typeof item.image === 'string' && item.image.trim().length > 0 && !isPlaceholderImageUrl(item.image))
              ? item.image.trim()
              : (!isGenItem ? (crossStoreImageMap.get(item.barcode) || null) : null);

            newProductsPayload.push({
              ...item,
              stock: Math.max(0, Number(item.stock) || 0),
              is_featured: isNewZeroPrice ? false : Boolean(item.is_featured),
              image: finalImage
            });
         }
      });

      if (unchangedExistingRowsForCache.length > 0) {
        updateTenantDeltaCacheWithRows(targetTenantId, unchangedExistingRowsForCache, targetIgnoreErpPrices);
      }

      if (chunkIgnoredNewZeroStock > 0) {
        console.log(`[Integration] Tenant ${targetTenantId}: ${chunkIgnoredNewZeroStock} produto(s) novo(s) ignorado(s) no lote por estarem com estoque <= 0 ou inativos.`);
      }

      let chunkInsertedCount = 0;
      let chunkUpdatedCount = 0;
      let chunkItemFallbackCount = 0;
      let chunkFailedItemsCount = 0;

      const stripIdField = (rows: any[]) =>
        rows.map((r) => {
          const { id: _id, ...rest } = r;
          return rest;
        });

      if (newProductsPayload.length > 0) {
         let persistedNewRows: any[] = [];
         const dedupedNewByCode = deduplicateByConflictField(newProductsPayload, 'internal_code');
         const { error } = await supabaseAdmin
           .from('products')
           .upsert(dedupedNewByCode, { 
              onConflict: 'tenant_id,internal_code', 
              ignoreDuplicates: false 
           });
         if (!error) {
            persistedNewRows = dedupedNewByCode;
         } else {
            const dedupedNewByBarcode = deduplicateByConflictField(newProductsPayload, 'barcode');
            const { error: fallbackErr } = await supabaseAdmin
              .from('products')
              .upsert(dedupedNewByBarcode, { 
                 onConflict: 'tenant_id,barcode', 
                 ignoreDuplicates: false 
              });
            if (!fallbackErr) {
              persistedNewRows = dedupedNewByBarcode;
            } else {
              chunkItemFallbackCount++;
              console.warn(
                `[Integration Fallback] Tenant ${targetTenantId}: lote de ${newProductsPayload.length} novo(s) falhou (${fallbackErr.message}). Executando fallback item a item...`
              );
              for (const row of newProductsPayload) {
                const { id: _id, ...rowWithoutId } = row;
                const { error: itemCodeErr } = await supabaseAdmin
                  .from('products')
                  .upsert(rowWithoutId, { onConflict: 'tenant_id,internal_code', ignoreDuplicates: false });
                if (!itemCodeErr) {
                  persistedNewRows.push(row);
                  continue;
                }
                const { error: itemBcErr } = await supabaseAdmin
                  .from('products')
                  .upsert(rowWithoutId, { onConflict: 'tenant_id,barcode', ignoreDuplicates: false });
                if (!itemBcErr) {
                  persistedNewRows.push(row);
                  continue;
                }
                let recovered = false;
                try {
                  const orParts: string[] = [];
                  if (row.internal_code) orParts.push(`internal_code.eq.${row.internal_code}`);
                  if (row.barcode) orParts.push(`barcode.eq.${row.barcode}`);
                  if (orParts.length > 0) {
                    const { data: matchRows } = await supabaseAdmin
                      .from('products')
                      .select('id')
                      .eq('tenant_id', targetTenantId)
                      .or(orParts.join(','))
                      .limit(1);
                    if (matchRows && matchRows.length > 0) {
                      const { error: updMatchErr } = await supabaseAdmin
                        .from('products')
                        .update(rowWithoutId)
                        .eq('id', matchRows[0].id);
                      if (!updMatchErr) {
                        persistedNewRows.push({ ...row, id: matchRows[0].id });
                        recovered = true;
                      }
                    }
                  }
                } catch (_) {}
                if (!recovered) {
                  chunkFailedItemsCount++;
                  console.warn(
                    `[Integration Item Fallback Error] Tenant ${targetTenantId} | novo internal_code=${row.internal_code} barcode=${row.barcode}: ${itemBcErr.message}`
                  );
                }
              }
            }
         }
         chunkInsertedCount = persistedNewRows.length;
         if (persistedNewRows.length > 0) {
           updateTenantDeltaCacheWithRows(targetTenantId, persistedNewRows, targetIgnoreErpPrices);
         }
      }

      if (existingProductsPayload.length > 0) {
         let persistedExistingRows: any[] = [];
         const dedupedExistingById = deduplicateByConflictField(existingProductsPayload, 'id');
         const { error: idUpsertErr } = await supabaseAdmin
           .from('products')
           .upsert(dedupedExistingById, {
              onConflict: 'id',
              ignoreDuplicates: false
           });
         if (!idUpsertErr) {
            persistedExistingRows = dedupedExistingById;
         } else {
            const dedupedExistingByBarcode = deduplicateByConflictField(existingProductsPayload, 'barcode');
            const { error: bcFallbackErr } = await supabaseAdmin
              .from('products')
              .upsert(stripIdField(dedupedExistingByBarcode), { 
                 onConflict: 'tenant_id,barcode', 
                 ignoreDuplicates: false 
              });
            if (!bcFallbackErr) {
               persistedExistingRows = dedupedExistingByBarcode;
            } else {
               const dedupedExistingByCode = deduplicateByConflictField(existingProductsPayload, 'internal_code');
               const { error: codeFallbackErr } = await supabaseAdmin
                 .from('products')
                 .upsert(stripIdField(dedupedExistingByCode), { 
                    onConflict: 'tenant_id,internal_code', 
                    ignoreDuplicates: false 
                 });
               if (!codeFallbackErr) {
                 persistedExistingRows = dedupedExistingByCode;
               } else {
                 chunkItemFallbackCount++;
                 console.warn(
                   `[Integration Fallback] Tenant ${targetTenantId}: lote de ${existingProductsPayload.length} atualização(ões) falhou (${codeFallbackErr.message}). Executando fallback item a item...`
                 );
                 for (const row of existingProductsPayload) {
                   const { id: existingRowId, ...rowWithoutId } = row;
                   if (existingRowId) {
                     const { error: singleIdErr } = await supabaseAdmin
                       .from('products')
                       .update(rowWithoutId)
                       .eq('id', existingRowId);
                     if (!singleIdErr) {
                       persistedExistingRows.push(row);
                       continue;
                     }
                   }
                   const { error: singleCodeErr } = await supabaseAdmin
                     .from('products')
                     .upsert(rowWithoutId, { onConflict: 'tenant_id,internal_code', ignoreDuplicates: false });
                   if (!singleCodeErr) {
                     persistedExistingRows.push(row);
                     continue;
                   }
                   const { error: singleBcErr } = await supabaseAdmin
                     .from('products')
                     .upsert(rowWithoutId, { onConflict: 'tenant_id,barcode', ignoreDuplicates: false });
                   if (!singleBcErr) {
                     persistedExistingRows.push(row);
                     continue;
                   }
                   chunkFailedItemsCount++;
                   console.warn(
                     `[Integration Item Fallback Error] Tenant ${targetTenantId} | update internal_code=${row.internal_code} barcode=${row.barcode}: ${singleBcErr.message}`
                   );
                 }
               }
            }
         }
         chunkUpdatedCount = persistedExistingRows.length;
         if (persistedExistingRows.length > 0) {
           updateTenantDeltaCacheWithRows(targetTenantId, persistedExistingRows, targetIgnoreErpPrices);
         }
      }

      // Libera o event loop entre lotes para não bloquear /api/v1/integration/heartbeat
      await new Promise((resolve) => setImmediate(resolve));
      return {
        insertedCount: chunkInsertedCount,
        updatedCount: chunkUpdatedCount,
        unchangedCount: chunkUnchangedEqualityCount,
        ignoredByErpPricesCount: chunkIgnoredByErpPricesCount,
        skippedZeroStockCount: chunkIgnoredNewZeroStock,
        itemFallbackCount: chunkItemFallbackCount,
        failedItemsCount: chunkFailedItemsCount,
      };
    };

    const filterDeltaChangedProducts = async (
      normalizedItems: any[],
      targetTenantId: string,
      targetIgnoreErpPrices: boolean,
    ) => {
      const tenantHashMap = await getOrLoadTenantDeltaCache(targetTenantId, targetIgnoreErpPrices);
      const changedProducts: any[] = [];
      let unchangedCount = 0;
      let ignoredByErpPricesCount = 0;
      let skippedNewZeroStockInDelta = 0;

      for (let idx = 0; idx < normalizedItems.length; idx++) {
        if (idx > 0 && idx % 250 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        const item = normalizedItems[idx];
        const codeKey = normalizeDeltaCode(item.internal_code);
        const barcodeKey = normalizeDeltaCode(item.barcode);

        const cachedEntry = lookupCachedProductDeltaEntry(tenantHashMap, codeKey, barcodeKey);

        if (cachedEntry === undefined) {
          if (Number(item.stock) <= 0 || item._isExplicitlyInactive) {
            skippedNewZeroStockInDelta++;
            continue;
          }
          changedProducts.push(item);
        } else if (!isProductUnchangedInDelta(item, cachedEntry, targetIgnoreErpPrices)) {
          changedProducts.push(item);
        } else {
          if (targetIgnoreErpPrices && !isProductUnchangedInDelta(item, cachedEntry, false)) {
            ignoredByErpPricesCount++;
          } else {
            unchangedCount++;
          }
        }
      }

      return { changedProducts, unchangedCount, ignoredByErpPricesCount, skippedNewZeroStockInDelta };
    };

    const CHUNK_SIZE = 200;
    const isCacheWarm = tenantProductHashCache.has(tenantId) && (tenantProductHashCache.get(tenantId)?.size || 0) > 0;
    const isLargePayload = productsBatch.length > 250 || allNormalizedProducts.length > 250;

    // ==========================================================================
    // FAST ACK (< 200ms) PARA LOTES GRANDES (ex: 9.972 produtos enviados de uma vez pelo .exe)
    // OU QUANDO O CACHE DELTA AINDA ESTÁ FRIO NO SERVIDOR:
    // Responde 200 OK imediatamente ao Agente Desktop (evitando qualquer timeout de 20s)
    // e executa a carga do Delta Cache + atualização em lotes em background com trava por tenant.
    // ==========================================================================
    if (isLargePayload || !isCacheWarm || (Date.now() - syncRequestStartTime > 1500)) {
      const targetTenantId = tenantId;
      const existingPendingJob = tenantPendingNormalizedBatch.get(targetTenantId);
      if (existingPendingJob) {
        const mergedMap = new Map<string, any>();
        for (const p of [...existingPendingJob.products, ...allNormalizedProducts]) {
          const k = normalizeDeltaCode(p.internal_code) || normalizeDeltaCode(p.barcode);
          if (k) mergedMap.set(k, p);
        }
        tenantPendingNormalizedBatch.set(targetTenantId, {
          products: Array.from(mergedMap.values()),
          totalReceived: existingPendingJob.totalReceived + productsBatch.length,
          ignoreErpPrices,
        });
      } else {
        tenantPendingNormalizedBatch.set(targetTenantId, {
          products: allNormalizedProducts,
          totalReceived: productsBatch.length,
          ignoreErpPrices,
        });
      }

      if (!tenantBackgroundSyncActive.has(targetTenantId)) {
        tenantBackgroundSyncActive.add(targetTenantId);
        setImmediate(async () => {
          try {
            while (tenantPendingNormalizedBatch.has(targetTenantId)) {
              const job = tenantPendingNormalizedBatch.get(targetTenantId)!;
              tenantPendingNormalizedBatch.delete(targetTenantId);

              const { changedProducts, unchangedCount, ignoredByErpPricesCount, skippedNewZeroStockInDelta } =
                await filterDeltaChangedProducts(job.products, targetTenantId, job.ignoreErpPrices);

              if (changedProducts.length === 0) {
                console.log(
                  `[Delta Sync BG] Tenant ${targetTenantId}: 0 atualizados de ${job.totalReceived} recebidos ` +
                  `(${unchangedCount} ignorados por igualdade, ${ignoredByErpPricesCount} ignorados por ignore_erp_prices=${job.ignoreErpPrices}, ${skippedNewZeroStockInDelta} novos sem estoque ignorados).`
                );
                continue;
              }

              console.log(
                `[Delta Sync BG] Tenant ${targetTenantId}: processando ${changedProducts.length} produto(s) candidato(s) em background ` +
                `(${unchangedCount} ignorados por igualdade, ${ignoredByErpPricesCount} ignorados por ignore_erp_prices=${job.ignoreErpPrices}, ${skippedNewZeroStockInDelta} sem estoque ignorados)...`
              );

              let bgInserted = 0;
              let bgUpdated = 0;
              let bgChunkUnchanged = 0;
              let bgChunkIgnoredErpPrices = 0;
              let bgChunkZeroStock = 0;
              let bgItemFallbacks = 0;
              let bgFailedItems = 0;

              for (let i = 0; i < changedProducts.length; i += CHUNK_SIZE) {
                const bgChunk = changedProducts.slice(i, i + CHUNK_SIZE);
                try {
                  const chunkStats = await processProductChunk(bgChunk, targetTenantId, job.ignoreErpPrices);
                  bgInserted += chunkStats.insertedCount;
                  bgUpdated += chunkStats.updatedCount;
                  bgChunkUnchanged += chunkStats.unchangedCount;
                  bgChunkIgnoredErpPrices += chunkStats.ignoredByErpPricesCount;
                  bgChunkZeroStock += chunkStats.skippedZeroStockCount;
                  bgItemFallbacks += chunkStats.itemFallbackCount;
                  bgFailedItems += chunkStats.failedItemsCount;
                } catch (chunkErr: any) {
                  bgFailedItems += bgChunk.length;
                  console.error(
                    `[Delta Sync BG] Tenant ${targetTenantId}: falha inesperada no chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunkErr?.message || chunkErr}). Continuando próximos lotes...`
                  );
                }
              }

              const bgPersistedTotal = bgInserted + bgUpdated;
              const totalEqualitySkipped = unchangedCount + bgChunkUnchanged;
              const totalErpPricesSkipped = ignoredByErpPricesCount + bgChunkIgnoredErpPrices;
              const totalZeroStockSkipped = skippedNewZeroStockInDelta + bgChunkZeroStock;

              void logIntegration(targetTenantId, "/api/v1/integration", {
                message: `Sincronização Delta em background concluída (${bgPersistedTotal} atualizados [${bgInserted} novos, ${bgUpdated} editados], ${totalEqualitySkipped} ignorados por igualdade, ${totalErpPricesSkipped} ignorados por ignore_erp_prices)`,
                productsBatchSize: job.totalReceived,
                processedCount: bgPersistedTotal,
                insertedCount: bgInserted,
                updatedCount: bgUpdated,
                unchangedCount: totalEqualitySkipped,
                ignoredByErpPricesCount: totalErpPricesSkipped,
                ignoredZeroStockCount: totalZeroStockSkipped,
                itemFallbackCount: bgItemFallbacks,
                failedItemsCount: bgFailedItems,
                isSuccess: bgFailedItems === 0,
                backgroundCompleted: true,
              }, "SUCCESS").catch(() => {});

              console.log(
                `[Delta Sync BG] Tenant ${targetTenantId}: concluído — ${bgPersistedTotal} atualizados (${bgInserted} novos, ${bgUpdated} existentes) de ${job.totalReceived} recebidos | ` +
                `${totalEqualitySkipped} ignorados por igualdade | ${totalErpPricesSkipped} ignorados por ignore_erp_prices | ${totalZeroStockSkipped} sem estoque ignorados` +
                `${bgItemFallbacks > 0 ? ` | ${bgItemFallbacks} lote(s) com fallback item a item` : ""}` +
                `${bgFailedItems > 0 ? ` | ${bgFailedItems} falha(s) isolada(s)` : ""}.`
              );
            }
          } catch (bgErr: any) {
            console.error(`[Integration] Erro no processamento em background para tenant ${targetTenantId}:`, bgErr?.message || bgErr);
          } finally {
            tenantBackgroundSyncActive.delete(targetTenantId);
          }
        });
      }

      console.log(
        `[Integration Fast-ACK] Tenant ${tenantId}: ${productsBatch.length} produtos recebidos e confirmados em ${Date.now() - syncRequestStartTime}ms (processamento Delta em background).`
      );

      return res.status(200).json({
        success: true,
        totalReceived: productsBatch.length,
        upserted: allNormalizedProducts.length,
        processed: allNormalizedProducts.length,
        backgroundQueued: allNormalizedProducts.length,
        deltaSync: true,
      });
    }

    // ==========================================================================
    // CAMINHO RÁPIDO PARA LOTES PEQUENOS (<= 250 itens) COM CACHE QUENTE EM RAM:
    // ==========================================================================
    const { changedProducts, unchangedCount, skippedNewZeroStockInDelta } =
      await filterDeltaChangedProducts(allNormalizedProducts, tenantId, ignoreErpPrices);

    if (changedProducts.length === 0) {
      console.log(
        `[Delta Sync] Tenant ${tenantId}: 0 alterações aplicáveis em ${productsBatch.length} produtos recebidos ` +
        `(${unchangedCount} inalterados, ${skippedNewZeroStockInDelta} novos com estoque <= 0/inativos ignorados em ${Date.now() - syncRequestStartTime}ms). Nenhum UPSERT executado no Supabase.`,
      );
      return res.status(200).json({
        success: true,
        totalReceived: productsBatch.length,
        upserted: 0,
        processed: 0,
        unchanged: unchangedCount,
        ignoredZeroStockNew: skippedNewZeroStockInDelta,
        deltaSync: true,
      });
    }

    const upsertPayload = changedProducts;
    const IMMEDIATE_PRODUCT_LIMIT = 200;
    const MAX_SYNC_MS_BEFORE_BACKGROUND = 2000;

    const allChunks: any[][] = [];
    for (let i = 0; i < upsertPayload.length; i += CHUNK_SIZE) {
      allChunks.push(upsertPayload.slice(i, i + CHUNK_SIZE));
    }

    let immediateProcessed = 0;
    let nextChunkIndex = 0;

    while (nextChunkIndex < allChunks.length) {
      const currentChunk = allChunks[nextChunkIndex];
      await processProductChunk(currentChunk, tenantId, ignoreErpPrices);
      immediateProcessed += currentChunk.length;
      nextChunkIndex++;

      const elapsedMs = Date.now() - syncRequestStartTime;
      if (
        nextChunkIndex < allChunks.length &&
        (immediateProcessed >= IMMEDIATE_PRODUCT_LIMIT || elapsedMs >= MAX_SYNC_MS_BEFORE_BACKGROUND)
      ) {
        break;
      }
    }

    const remainingChunks = allChunks.slice(nextChunkIndex);
    const totalToProcess = upsertPayload.length;

    if (remainingChunks.length > 0) {
      const remainingCount = totalToProcess - immediateProcessed;
      const targetTenantId = tenantId;

      setImmediate(async () => {
        let bgProcessed = immediateProcessed;
        try {
          for (const bgChunk of remainingChunks) {
            await processProductChunk(bgChunk, targetTenantId, ignoreErpPrices);
            bgProcessed += bgChunk.length;
          }
          void logIntegration(targetTenantId, "/api/v1/integration", {
            message: `Sincronização Delta em background concluída com sucesso (${bgProcessed} alterados/novos de ${productsBatch.length} recebidos)`,
            productsBatchSize: productsBatch.length,
            processedCount: bgProcessed,
            unchangedCount,
            isSuccess: true,
            backgroundCompleted: true,
          }, "SUCCESS").catch(() => {});
        } catch (bgErr: any) {
          console.error(`[Integration] Erro no processamento em background para tenant ${targetTenantId}:`, bgErr?.message || bgErr);
        }
      });

      return res.status(200).json({
        success: true,
        totalReceived: productsBatch.length,
        upserted: totalToProcess,
        processed: totalToProcess,
        immediateProcessed,
        backgroundQueued: remainingCount,
        unchanged: unchangedCount,
        deltaSync: true,
      });
    }

    void logIntegration(tenantId, "/api/v1/integration", { 
      message: `Sincronização Delta do agente concluída com sucesso (${immediateProcessed} alterados/novos, ${unchangedCount} inalterados)`, 
      productsBatchSize: productsBatch.length, 
      processedCount: immediateProcessed,
      unchangedCount,
      isSuccess: true 
    }, "SUCCESS").catch(() => {});

    res.status(200).json({
      success: true,
      totalReceived: productsBatch.length,
      upserted: immediateProcessed,
      processed: immediateProcessed,
      unchanged: unchangedCount,
      deltaSync: true,
    });

  } catch (error: any) {
    console.error("[Integration] Error:", error.message);
    try {
      if (tenantId) {
        await logIntegration(tenantId, "/api/v1/integration", { 
          isSuccess: false,
          error: error.message 
        }, "FAILED", error.message);
      }
    } catch (logErr) {
      console.error("Erro ao salvar log de erro de integração:", logErr);
    }
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
};

app.post([
  "/api/v1/integration",
  "/api/v1/desktop-agent/sync",
  "/api/desktop-agent/sync",
  "/api/v1/products/sync-erp",
  "/api/v1/agent/sync",
  "/api/v1/sync",
  "/api/sync"
], handleProductIntegration);

// Rotas para consultar, cadastrar e aplicar regras de divisão/correção de preço (ex: fração 12 Dryon)
app.get("/api/v1/products/price-rules", async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId || req.headers["x-tenant-id"] || "").trim();
    const rules = tenantId
      ? await getTenantPriceDivisorRules(tenantId, undefined, true)
      : DEFAULT_GLOBAL_PRICE_DIVISOR_RULES;
    return res.status(200).json({ success: true, rules });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao listar regras de preço" });
  }
});

app.post("/api/v1/products/price-rules", async (req, res) => {
  try {
    const tenantId = String(req.body?.tenant_id || req.body?.tenantId || req.headers["x-tenant-id"] || "").trim() || null;
    const divisor = Number(req.body?.divisor || 12);
    if (!Number.isFinite(divisor) || divisor <= 1) {
      return res.status(400).json({ error: "O divisor deve ser maior que 1 (ex: 12)." });
    }

    const newRule: ProductPriceDivisorRule = {
      tenant_id: tenantId,
      internal_code: req.body?.internal_code ? String(req.body.internal_code).trim() : null,
      barcode: req.body?.barcode || req.body?.ean ? String(req.body.barcode || req.body.ean).trim() : null,
      name_pattern: req.body?.name_pattern ? String(req.body.name_pattern).trim() : null,
      divisor,
      min_raw_price:
        req.body?.min_raw_price !== undefined && req.body?.min_raw_price !== null
          ? Number(req.body.min_raw_price)
          : null,
      active: true,
    };

    // Tenta salvar na tabela product_price_rules (se existir) e também em delivery_settings.price_divisor_rules do tenant
    let savedRow: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from("product_price_rules")
        .insert([newRule])
        .select()
        .single();
      if (!error && data) {
        savedRow = data;
      }
    } catch (_e) {}

    if (tenantId) {
      const { data: tenantData } = await supabaseAdmin
        .from("tenants")
        .select("delivery_settings")
        .eq("id", tenantId)
        .maybeSingle();
      const currentSettings =
        tenantData?.delivery_settings && typeof tenantData.delivery_settings === "object"
          ? tenantData.delivery_settings
          : {};
      const currentList = Array.isArray(currentSettings.price_divisor_rules)
        ? currentSettings.price_divisor_rules
        : [];
      const ruleWithId = savedRow || { ...newRule, id: `rule-${Date.now()}` };
      currentList.push(ruleWithId);
      await supabaseAdmin
        .from("tenants")
        .update({
          delivery_settings: {
            ...currentSettings,
            price_divisor_rules: currentList,
          },
        })
        .eq("id", tenantId);
      tenantPriceRulesCache.delete(tenantId);
      tenantProductHashCache.delete(tenantId);
    }

    const cleanupResult = await applyPriceDivisorRulesToExistingProducts(tenantId || undefined);

    return res.status(200).json({
      success: true,
      rule: savedRow || newRule,
      ...cleanupResult,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao salvar regra de preço" });
  }
});

app.post("/api/v1/products/price-rules/apply-now", async (req, res) => {
  try {
    const tenantId = String(req.body?.tenant_id || req.body?.tenantId || req.query.tenantId || req.headers["x-tenant-id"] || "").trim() || undefined;
    const result = await applyPriceDivisorRulesToExistingProducts(tenantId);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao aplicar regras de preço" });
  }
});

// =========================================
// MÓDULO FARMAFLOW CHAT - ROTAS DE BACKEND
// =========================================

// Middleware para verificar se o chat está ativado
const requireChatEnabled = async (req: any, res: any, next: any) => {
  try {
    // Webhooks de provedores externos devem ser sempre permitidos para evitar perda de mensagens
    if (req.path?.includes('/webhook') || req.url?.includes('/webhook')) {
      return next();
    }

    let tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Se não tiver o header direto, tenta extrair da conversa ou instancia dependendo da rota
    if (!tenantId && req.body?.conversation_id) {
       const { data: conv } = await supabaseAdmin.from('chat_conversations').select('store_id').eq('id', req.body.conversation_id).single();
       if (conv) tenantId = conv.store_id;
    }
    
    // Em caso de webhook de provedor externo (Evolution API), a instancia geralmente contém ou mapeia o tenantId
    if (!tenantId && req.body?.data?.instance) {
       const { data: inst } = await supabaseAdmin.from('whatsapp_instances').select('store_id').eq('instance_name', req.body.data.instance).single();
       if (inst) tenantId = inst.store_id;
    }

    if (tenantId) {
       try {
         const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name, is_chat_enabled').eq('id', tenantId).maybeSingle();
         if (tenant && tenant.is_chat_enabled === false) {
            return res.status(403).json({ error: "Módulo de Chat desativado para esta loja." });
         }
       } catch (tErr: any) {
         console.warn("[Chat Middleware] Aviso ao consultar licença do tenant:", tErr?.message);
       }
    }
    
    next();
  } catch (error) {
    console.error("[Chat Middleware] Erro ao validar licença:", error);
    next(); // Falha aberta para não quebrar em caso de instabilidade
  }
};



// --- EVOLUTION API WHATSAPP INSTANCE ENDPOINTS ---

const DEFAULT_EVOLUTION_URL = 'https://evolution.nexoia.online';
const DEFAULT_CHAT_WEBHOOK_URL = 'https://farmaflow.online/api/v1/chat/webhook';
const EVOLUTION_WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'SEND_MESSAGE',
];

function normalizeEvolutionUrl(url?: string): string {
  if (!url) return DEFAULT_EVOLUTION_URL;
  let cleaned = String(url).replace(/[\r\n\t]+/g, '').trim();
  if (!cleaned) return DEFAULT_EVOLUTION_URL;

  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname
      .replace(/\/manager(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
    return `${protocol}//${host}${pathname}`;
  } catch (e) {
    return cleaned
      .replace(/[?#].*$/, '')
      .replace(/\/manager(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
  }
}

function resolveChatWebhookUrl(req: express.Request): string {
  const envUrl = String(process.env.CHAT_WEBHOOK_URL || '').trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }

  const rawHost = String(
    req.headers['x-forwarded-host'] || req.headers.host || ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
  const hostWithoutPort = rawHost.split(':')[0];

  if (
    !hostWithoutPort ||
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === 'farmaflow.online' ||
    hostWithoutPort === 'www.farmaflow.online' ||
    hostWithoutPort.endsWith('.farmaflow.online')
  ) {
    return DEFAULT_CHAT_WEBHOOK_URL;
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return `${proto === 'http' ? 'http' : 'https'}://${rawHost}/api/v1/chat/webhook`;
}

async function safeEvolutionRequest(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 7000
): Promise<{ ok: boolean; status: number; data: any; rawText?: string; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    let data: any = null;
    let rawText = "";

    if (contentType.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      rawText = await res.text().catch(() => "");
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { message: rawText };
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      rawText
    };
  } catch (fetchErr: any) {
    clearTimeout(timeout);
    const isTimeout = fetchErr.name === "AbortError" || fetchErr.message?.includes("aborted");
    const errMsg = isTimeout
      ? `Tempo limite esgotado (${timeoutMs / 1000}s) ao contatar ${url}`
      : `Servidor da Evolution inacessível em ${url}: ${fetchErr.message || 'Falha de conexão/DNS'}`;
    return {
      ok: false,
      status: 502,
      data: null,
      error: errMsg
    };
  }
}

interface EvolutionWebhookRegistrationResult {
  ok: boolean;
  status: number;
  formatUsed?: string;
  webhookUrl: string;
  events: string[];
  error?: string;
  response?: any;
  attempts: Array<{ format: string; status: number; detail?: any }>;
}

type EvolutionKeySource = 'body' | 'db_loja' | 'env' | 'none';

interface ResolvedEvolutionConfig {
  tenantId: string;
  evolutionUrl: string;
  evolutionKey: string;
  instanceName: string;
  evoHeaders: Record<string, string>;
  keySource: EvolutionKeySource;
  isCustomServer: boolean;
  envEvolutionUrl: string;
  envEvolutionKey: string;
  shouldSyncDbWithEnv?: boolean;
}

function isMaskedEvolutionKey(raw?: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  return s.includes('•') || s.includes('***') || s.includes('•••');
}

function sanitizeEvolutionApiKey(raw?: unknown): string {
  if (raw === null || raw === undefined) return '';
  let cleaned = String(raw).replace(/[\r\n\t]+/g, '').trim();
  if (!cleaned || isMaskedEvolutionKey(cleaned)) return '';
  // Remove qualquer prefixo "Bearer " colado por engano
  cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
  // Remove aspas acidentais envolvendo a chave
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned || isMaskedEvolutionKey(cleaned)) return '';
  return cleaned;
}

function maskEvolutionKeyPreview(key: string): string {
  const clean = String(key || '');
  if (!clean) return '(vazia)';
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}...${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function logEvolution401Diagnostic(url: string, key: string, keySource: EvolutionKeySource) {
  console.error(
    `[Evolution API 401] Unauthorized | origem=${keySource} | length=${key.length} | preview=${maskEvolutionKeyPreview(key)} | url=${url}`
  );
}

function buildEvolutionHeaders(evolutionKey: string): Record<string, string> {
  const cleanKey = sanitizeEvolutionApiKey(evolutionKey);
  // Cabeçalho exato exigido pela Evolution API v2 (NUNCA duplicar apikey/apiKey nem enviar Authorization: Bearer)
  return {
    apikey: cleanKey,
    'Content-Type': 'application/json',
  };
}

async function persistHealedEvolutionKey(config: ResolvedEvolutionConfig, workingKey: string) {
  const cleanKey = sanitizeEvolutionApiKey(workingKey);
  if (!cleanKey || !config.instanceName) return;
  try {
    const { data: existing } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', config.instanceName)
      .maybeSingle();

    if (existing?.id) {
      await supabaseAdmin
        .from('whatsapp_instances')
        .update({
          evolution_url: config.evolutionUrl,
          evolution_key: cleanKey,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      console.log(
        `[Evolution API] Configuração da instância "${config.instanceName}" sincronizada automaticamente com EVOLUTION_API_KEY ativa (${maskEvolutionKeyPreview(cleanKey)}).`
      );
    }
  } catch (err: any) {
    console.warn('[Evolution API] Aviso ao atualizar chave sincronizada no banco:', err?.message || err);
  }
}

async function evolutionRequestWithFallback(
  config: ResolvedEvolutionConfig,
  endpointPathOrUrl: string,
  options: RequestInit = {},
  timeoutMs: number = 7000,
  allowEnvFallback: boolean = true
): Promise<{ ok: boolean; status: number; data: any; rawText?: string; error?: string }> {
  const fullUrl = /^https?:\/\//i.test(endpointPathOrUrl)
    ? endpointPathOrUrl
    : `${config.evolutionUrl}${endpointPathOrUrl.startsWith('/') ? '' : '/'}${endpointPathOrUrl}`;

  const res = await safeEvolutionRequest(
    fullUrl,
    {
      ...options,
      headers: buildEvolutionHeaders(config.evolutionKey),
    },
    timeoutMs
  );

  if (res.status === 401) {
    logEvolution401Diagnostic(fullUrl, config.evolutionKey, config.keySource);

    if (
      allowEnvFallback &&
      config.envEvolutionKey &&
      config.evolutionKey !== config.envEvolutionKey
    ) {
      console.warn(
        `[Evolution API] Tentando fallback automático com EVOLUTION_API_KEY (env · ${maskEvolutionKeyPreview(config.envEvolutionKey)}) para ${fullUrl}...`
      );
      const retryRes = await safeEvolutionRequest(
        fullUrl,
        {
          ...options,
          headers: buildEvolutionHeaders(config.envEvolutionKey),
        },
        timeoutMs
      );

      if (retryRes.status === 401) {
        logEvolution401Diagnostic(fullUrl, config.envEvolutionKey, 'env');
      } else {
        config.evolutionKey = config.envEvolutionKey;
        config.keySource = 'env';
        config.evoHeaders = buildEvolutionHeaders(config.envEvolutionKey);
        config.shouldSyncDbWithEnv = false;
        await persistHealedEvolutionKey(config, config.envEvolutionKey);
      }
      return retryRes;
    }

    return res;
  }

  if (
    config.shouldSyncDbWithEnv &&
    config.keySource === 'env' &&
    config.envEvolutionKey &&
    config.evolutionKey === config.envEvolutionKey
  ) {
    config.shouldSyncDbWithEnv = false;
    persistHealedEvolutionKey(config, config.envEvolutionKey).catch(() => {});
  }

  return res;
}

async function registerEvolutionWebhook(params: {
  evolutionUrl: string;
  evolutionKey: string;
  instanceName: string;
  webhookUrl: string;
  evoConfig?: ResolvedEvolutionConfig;
}): Promise<EvolutionWebhookRegistrationResult> {
  const cleanUrl = normalizeEvolutionUrl(params.evoConfig?.evolutionUrl || params.evolutionUrl);
  const cleanKey = sanitizeEvolutionApiKey(params.evoConfig?.evolutionKey || params.evolutionKey);
  const cleanInstance = String(params.evoConfig?.instanceName || params.instanceName || '').trim();
  const targetWebhookUrl = String(params.webhookUrl || DEFAULT_CHAT_WEBHOOK_URL).trim();

  const endpoint = `${cleanUrl}/webhook/set/${encodeURIComponent(cleanInstance)}`;

  // Sequência de compatibilidade Evolution API:
  // 1º) v2.2+  2º) v2.0/v2.1  3º) v1 (plano)
  const payloads: Array<{ format: string; body: Record<string, any> }> = [
    {
      format: 'Evolution v2.2+',
      body: {
        webhook: {
          enabled: true,
          url: targetWebhookUrl,
          byEvents: false,
          base64: true,
          events: EVOLUTION_WEBHOOK_EVENTS,
        },
      },
    },
    {
      format: 'Evolution v2.0/v2.1',
      body: {
        webhook: {
          enabled: true,
          url: targetWebhookUrl,
          webhookByEvents: false,
          webhookBase64: true,
          events: EVOLUTION_WEBHOOK_EVENTS,
        },
      },
    },
    {
      format: 'Evolution v1',
      body: {
        enabled: true,
        url: targetWebhookUrl,
        webhook_by_events: false,
        webhook_base64: true,
        events: EVOLUTION_WEBHOOK_EVENTS,
      },
    },
  ];

  const attempts: Array<{ format: string; status: number; detail?: any }> = [];
  let lastStatus = 0;
  let lastResponse: any = null;
  let lastErrorMsg = '';

  for (const attempt of payloads) {
    const res = params.evoConfig
      ? await evolutionRequestWithFallback(
          params.evoConfig,
          endpoint,
          {
            method: 'POST',
            body: JSON.stringify(attempt.body),
          },
          8000,
          params.evoConfig.keySource !== 'body' || !params.evoConfig.isCustomServer
        )
      : await safeEvolutionRequest(
          endpoint,
          {
            method: 'POST',
            headers: buildEvolutionHeaders(cleanKey),
            body: JSON.stringify(attempt.body),
          },
          8000
        );

    if (!params.evoConfig && res.status === 401) {
      logEvolution401Diagnostic(endpoint, cleanKey, 'none');
    }

    const detail = res.data ?? (res.rawText || res.error || null);
    attempts.push({ format: attempt.format, status: res.status, detail });
    lastStatus = res.status;
    lastResponse = detail;

    if (res.ok) {
      console.log(
        `[Evolution Webhook] Webhook registrado com sucesso em "${cleanInstance}" via ${attempt.format} (HTTP ${res.status}) -> ${targetWebhookUrl}`
      );
      return {
        ok: true,
        status: res.status,
        formatUsed: attempt.format,
        webhookUrl: targetWebhookUrl,
        events: EVOLUTION_WEBHOOK_EVENTS,
        response: detail,
        attempts,
      };
    }

    const detailString =
      typeof detail === 'string'
        ? detail
        : JSON.stringify(detail || res.error || 'Sem corpo de resposta');

    lastErrorMsg =
      res.error ||
      (typeof res.data?.message === 'string'
        ? res.data.message
        : Array.isArray(res.data?.response?.message)
          ? res.data.response.message.join('; ')
          : typeof res.data?.response?.message === 'string'
            ? res.data.response.message
            : typeof res.data?.error === 'string'
              ? res.data.error
              : detailString);

    console.warn(
      `[Evolution Webhook] Falha ao registrar webhook em "${cleanInstance}" (${attempt.format}, HTTP ${res.status}): ${detailString}`
    );

    // Só avança para o próximo formato de compatibilidade em erro de validação/payload (400 ou 422)
    if (res.status !== 400 && res.status !== 422) {
      break;
    }
  }

  console.error(
    `[Evolution Webhook] Registro de webhook FALHOU para "${cleanInstance}" em ${endpoint} (HTTP ${lastStatus}):`,
    JSON.stringify(lastResponse || lastErrorMsg)
  );

  return {
    ok: false,
    status: lastStatus || 500,
    webhookUrl: targetWebhookUrl,
    events: EVOLUTION_WEBHOOK_EVENTS,
    error: `HTTP ${lastStatus || 500}: ${lastErrorMsg || 'Falha ao registrar webhook na Evolution API.'}`,
    response: lastResponse,
    attempts,
  };
}

function isPlaceholderEvolutionUrl(url?: string | null): boolean {
  const raw = String(url || '').replace(/[\r\n\t]+/g, '').trim().toLowerCase();
  if (!raw) return true;
  return (
    raw.includes('seudominio.com') ||
    raw.includes('yourdomain.com') ||
    raw.includes('example.com')
  );
}

function formatEvolutionErrorDetail(res: { status: number; data: any; rawText?: string; error?: string }): string {
  if (res.error && !res.data && !res.rawText) {
    return res.error;
  }
  const d = res.data;
  if (typeof d === 'string' && d.trim()) return d.trim();
  if (Array.isArray(d?.response?.message)) return d.response.message.join('; ');
  if (typeof d?.response?.message === 'string' && d.response.message.trim()) return d.response.message.trim();
  if (Array.isArray(d?.message)) return d.message.join('; ');
  if (typeof d?.message === 'string' && d.message.trim()) return d.message.trim();
  if (typeof d?.error === 'string' && d.error.trim()) return d.error.trim();
  if (d && typeof d === 'object') {
    try {
      return JSON.stringify(d);
    } catch {
      // ignore
    }
  }
  if (res.rawText && res.rawText.trim()) return res.rawText.trim().slice(0, 300);
  return res.error || 'Resposta sem detalhes da Evolution API.';
}

function isEvolutionAlreadyExistsError(status: number, data: any, rawText?: string): boolean {
  if (status === 409) return true;
  if (status !== 403 && status !== 400) return false;
  const txt = `${JSON.stringify(data || '')} ${rawText || ''}`.toLowerCase();
  return (
    txt.includes('already in use') ||
    txt.includes('already exist') ||
    txt.includes('já existe') ||
    txt.includes('ja existe') ||
    txt.includes('is already') ||
    txt.includes('duplicate')
  );
}

async function createEvolutionInstanceClean(params: {
  evoConfig: ResolvedEvolutionConfig;
}): Promise<{
  ok: boolean;
  alreadyExists: boolean;
  status: number;
  data: any;
  error?: string;
  rawResponse?: any;
}> {
  const { evoConfig } = params;
  const { evolutionUrl, instanceName } = evoConfig;

  // Payload mínimo e padrão da Evolution API v2 (NUNCA misturar bloco webhook no /instance/create)
  const cleanCreatePayload = {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  };

  console.log(
    `[Evolution API] Criando instância limpa "${instanceName}" em ${evolutionUrl}/instance/create (chave=${evoConfig.keySource})`
  );

  const createRes = await evolutionRequestWithFallback(
    evoConfig,
    '/instance/create',
    {
      method: 'POST',
      body: JSON.stringify(cleanCreatePayload),
    },
    10000,
    evoConfig.keySource !== 'body' || !evoConfig.isCustomServer
  );

  if (createRes.ok) {
    console.log(
      `[Evolution API] Instância "${instanceName}" criada com sucesso (HTTP ${createRes.status}).`
    );
    return {
      ok: true,
      alreadyExists: false,
      status: createRes.status,
      data: createRes.data,
    };
  }

  // Se já existe (HTTP 403/409 "already in use"), segue normalmente para /instance/connect sem erro fatal
  if (isEvolutionAlreadyExistsError(createRes.status, createRes.data, createRes.rawText)) {
    console.log(
      `[Evolution API] Instância "${instanceName}" já existe na Evolution (HTTP ${createRes.status}). Seguindo para /instance/connect...`
    );
    return {
      ok: true,
      alreadyExists: true,
      status: createRes.status,
      data: createRes.data,
    };
  }

  const detail = formatEvolutionErrorDetail(createRes);
  console.error(
    `[Evolution API] ERRO ao criar instância "${instanceName}" em ${evolutionUrl}/instance/create (HTTP ${createRes.status}):`,
    detail
  );

  return {
    ok: false,
    alreadyExists: false,
    status: createRes.status || 500,
    data: createRes.data,
    error: `Falha ao criar instância "${instanceName}" na Evolution API (HTTP ${createRes.status || 500}): ${detail}`,
    rawResponse: createRes.data ?? createRes.rawText ?? null,
  };
}

function extractOverrideUrl(override?: any): string {
  if (!override || typeof override !== 'object') return '';
  const candidate =
    override.evolutionUrl ??
    override.url ??
    override.evolution_url ??
    override.evolutionApiUrl ??
    override.evolution_api_url ??
    '';
  return String(candidate || '').replace(/[\r\n\t]+/g, '').trim();
}

function extractOverrideApiKey(override?: any): string {
  if (!override || typeof override !== 'object') return '';
  const candidates = [
    override.apiKey,
    override.evolutionApiKey,
    override.evolution_api_key,
    override.evolutionKey,
    override.evolution_key,
    override.apikey,
  ];
  for (const raw of candidates) {
    const clean = sanitizeEvolutionApiKey(raw);
    if (clean) return clean;
  }
  return '';
}

function buildFallbackExclusiveInstanceName(inboxId?: string | null): string {
  const cleanInbox = String(inboxId || "")
    .replace(/^inbox_/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const segment = (cleanInbox || "default").slice(0, 20);
  return `inbox_ex_${segment}`;
}

async function assertSafeExclusiveInstanceTarget(
  tenantId: string,
  targetInstanceName: string,
  inboxId?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const cleanTarget = String(targetInstanceName || "").trim();
  if (!cleanTarget) {
    return { ok: false, error: "Nome da instância exclusiva não informado." };
  }
  if (cleanTarget.toLowerCase().startsWith("store_")) {
    return {
      ok: false,
      error: "Ação bloqueada: esta operação exclusiva não pode alterar a instância principal compartilhada da loja.",
    };
  }

  try {
    const { data: instRow } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, instance_name, store_id")
      .eq("instance_name", cleanTarget)
      .maybeSingle();

    if (instRow?.id && isValidUuid(instRow.id)) {
      const { data: linkedInboxes } = await supabaseAdmin
        .from("inboxes")
        .select("id")
        .eq("whatsapp_instance_id", instRow.id);

      const otherInboxes = (linkedInboxes || []).filter(
        (ib: any) => ib?.id && (!inboxId || ib.id !== inboxId)
      );

      if (otherInboxes.length > 0) {
        return {
          ok: false,
          error: `Ação bloqueada: a instância "${cleanTarget}" está em uso compartilhado por outra(s) caixa(s) de entrada da loja.`,
        };
      }

      // Se a instância não tem padrão exclusivo (ex: inbox_<uuid> de outra caixa ou antiga compartilhada),
      // verifica se o nome não pertence a outra caixa da loja
      if (!isExclusiveInstanceName(cleanTarget) && inboxId) {
        const cleanInboxId = String(inboxId).replace(/^inbox_/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        if (cleanTarget.toLowerCase().startsWith("inbox_") && !cleanTarget.toLowerCase().includes(cleanInboxId)) {
          return {
            ok: false,
            error: `Ação bloqueada: a instância "${cleanTarget}" não pertence a esta caixa exclusiva.`,
          };
        }
      }
    }
  } catch (err: any) {
    console.warn("[ExclusiveGuard] Aviso ao validar instância exclusiva:", err?.message || err);
  }

  return { ok: true };
}

async function resolveEvolutionConfig(
  tenantId: string,
  bodyOverrideOrInboxId?: string | Record<string, any>,
  maybeOverride?: Record<string, any>
): Promise<ResolvedEvolutionConfig> {
  const override: Record<string, any> =
    typeof bodyOverrideOrInboxId === 'object' && bodyOverrideOrInboxId !== null
      ? bodyOverrideOrInboxId
      : maybeOverride || {};
  const inboxId: string | undefined =
    typeof bodyOverrideOrInboxId === 'string'
      ? bodyOverrideOrInboxId
      : typeof override?.inboxId === 'string'
        ? override.inboxId
        : undefined;

  const envEvolutionUrl =
    process.env.EVOLUTION_API_URL && !isPlaceholderEvolutionUrl(process.env.EVOLUTION_API_URL)
      ? normalizeEvolutionUrl(process.env.EVOLUTION_API_URL)
      : '';
  const envEvolutionKey = sanitizeEvolutionApiKey(process.env.EVOLUTION_API_KEY);

  const rawOverrideUrl = extractOverrideUrl(override);
  const rawOverrideKey = extractOverrideApiKey(override);

  // Se o cliente enviou apenas a URL padrão hardcoded enquanto o servidor tem EVOLUTION_API_URL na Easypanel,
  // prioriza a variável de ambiente quando a loja não tem configuração customizada salva.
  let evolutionUrl =
    rawOverrideUrl &&
    !isPlaceholderEvolutionUrl(rawOverrideUrl) &&
    !(envEvolutionUrl && normalizeEvolutionUrl(rawOverrideUrl) === DEFAULT_EVOLUTION_URL && envEvolutionUrl !== DEFAULT_EVOLUTION_URL)
      ? rawOverrideUrl
      : '';

  let evolutionKey = rawOverrideKey;
  let keySource: EvolutionKeySource = evolutionKey ? 'body' : 'none';
  let dbKeyFound = '';
  let instanceName =
    typeof override?.instanceName === 'string'
      ? override.instanceName.trim()
      : typeof override?.instance_name === 'string'
        ? override.instance_name.trim()
        : '';

  const rawTenant = (tenantId || "principal").replace(/^store_/, '').replace(/^tenant_/, '');
  const cleanStore = rawTenant.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  // 1. Identificar ou resolver o nome da instância
  const isExclusiveRequest = Boolean(override?.exclusive === true || override?.exclusive === "true");

  // Em requisições exclusivas, nunca aceita instância compartilhada/store_* vinda de estado antigo do cliente
  if (instanceName && isExclusiveRequest && inboxId) {
    const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, instanceName, inboxId);
    if (!safeCheck.ok) {
      console.warn(`[resolveEvolutionConfig] Ignorando instanceName "${instanceName}" para caixa exclusiva ${inboxId}: ${safeCheck.error}`);
      instanceName = '';
    }
  }

  if (!instanceName) {
    if (inboxId && inboxId !== "default" && !inboxId.includes("default")) {
      try {
        const { data: inboxRow } = await supabaseAdmin
          .from('inboxes')
          .select('whatsapp_instance_id')
          .eq('id', inboxId)
          .maybeSingle();

        if (inboxRow?.whatsapp_instance_id) {
          const isUuid = isValidUuid(inboxRow.whatsapp_instance_id);
          let linkedInst: any = null;

          if (isUuid) {
            const { data } = await supabaseAdmin
              .from('whatsapp_instances')
              .select('instance_name')
              .eq('id', inboxRow.whatsapp_instance_id)
              .maybeSingle();
            linkedInst = data;
          }

          if (!linkedInst) {
            const { data } = await supabaseAdmin
              .from('whatsapp_instances')
              .select('instance_name')
              .eq('instance_name', inboxRow.whatsapp_instance_id)
              .maybeSingle();
            linkedInst = data;
          }

          if (linkedInst?.instance_name) {
            if (isExclusiveRequest) {
              const safeLinked = await assertSafeExclusiveInstanceTarget(tenantId, linkedInst.instance_name, inboxId);
              if (safeLinked.ok) {
                instanceName = linkedInst.instance_name;
              }
            } else {
              instanceName = linkedInst.instance_name;
            }
          }
        }
      } catch (e) {}

      if (!instanceName) {
        if (isExclusiveRequest) {
          instanceName = buildFallbackExclusiveInstanceName(inboxId);
        } else {
          // Modo compartilhado: busca instância CONNECTED compartilhada da loja antes de cair no padrão store_<loja>
          try {
            const candidateStoreIds = await resolveStoreCandidateIds(tenantId);
            if (candidateStoreIds.length > 0) {
              const { data: storeInsts } = await supabaseAdmin
                .from('whatsapp_instances')
                .select('instance_name, updated_at')
                .in('store_id', candidateStoreIds)
                .eq('status', 'CONNECTED')
                .order('updated_at', { ascending: false });

              const validConnected = (storeInsts || []).filter((i: any) => i?.instance_name);
              const sharedInst = validConnected.find((i: any) => !isExclusiveInstanceName(i.instance_name)) || validConnected[0];
              if (sharedInst?.instance_name) {
                instanceName = sharedInst.instance_name;
              }
            }
          } catch (_) {}

          if (!instanceName) {
            instanceName = cleanStore ? `store_${cleanStore}` : 'store_principal';
          }
        }
      }
    } else {
      instanceName = cleanStore ? `store_${cleanStore}` : 'store_principal';
    }
  }

  // 2. Busca configuração customizada válida da loja no banco (somente se existir e for válida)
  try {
    if (!evolutionUrl || !evolutionKey) {
      const { data: byName } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_name', instanceName)
        .maybeSingle();

      if (byName) {
        const dbUrl = String(byName.evolution_url || '').replace(/[\r\n\t]+/g, '').trim();
        const dbKey = sanitizeEvolutionApiKey(byName.evolution_key);
        if (
          !evolutionUrl &&
          dbUrl &&
          !isPlaceholderEvolutionUrl(dbUrl) &&
          !(envEvolutionUrl && normalizeEvolutionUrl(dbUrl) === DEFAULT_EVOLUTION_URL && envEvolutionUrl !== DEFAULT_EVOLUTION_URL)
        ) {
          evolutionUrl = dbUrl;
        }
        if (!evolutionKey && dbKey) {
          evolutionKey = dbKey;
          dbKeyFound = dbKey;
          keySource = 'db_loja';
        }
      }
    }

    if (!evolutionUrl || !evolutionKey) {
      const targetStoreIds = Array.from(new Set([tenantId, cleanStore, `store_${cleanStore}`].filter(Boolean)));
      const { data: instList } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('*')
        .in('store_id', targetStoreIds)
        .order('updated_at', { ascending: false });

      if (instList && instList.length > 0) {
        const withKey = instList.find((i: any) => sanitizeEvolutionApiKey(i.evolution_key) !== '');
        const withUrl = instList.find((i: any) => {
          const u = String(i.evolution_url || '').replace(/[\r\n\t]+/g, '').trim();
          if (!u || isPlaceholderEvolutionUrl(u)) return false;
          if (envEvolutionUrl && normalizeEvolutionUrl(u) === DEFAULT_EVOLUTION_URL && envEvolutionUrl !== DEFAULT_EVOLUTION_URL) {
            return false;
          }
          return true;
        });

        if (withKey && !evolutionKey) {
          const cleanDbKey = sanitizeEvolutionApiKey(withKey.evolution_key);
          if (cleanDbKey) {
            evolutionKey = cleanDbKey;
            dbKeyFound = cleanDbKey;
            keySource = 'db_loja';
          }
        }
        if (withUrl && !evolutionUrl) {
          evolutionUrl = String(withUrl.evolution_url).replace(/[\r\n\t]+/g, '').trim();
        }
      }
    }

    if (!evolutionUrl || !evolutionKey) {
      try {
        const targetIdentifiers = Array.from(new Set([tenantId, cleanStore, `store_${cleanStore}`].filter(Boolean)));
        const { data: tenantRows } = await supabaseAdmin
          .from('tenants')
          .select('*')
          .or(`id.in.(${targetIdentifiers.join(',')}),slug.in.(${targetIdentifiers.join(',')})`)
          .limit(1);

        if (tenantRows && tenantRows.length > 0) {
          const t = tenantRows[0];
          const tUrl = String(t.evolution_url || t.evolution_api_url || '').replace(/[\r\n\t]+/g, '').trim();
          const tKey = sanitizeEvolutionApiKey(t.evolution_key || t.evolution_api_key || t.evolution_token);
          if (
            !evolutionUrl &&
            tUrl &&
            !isPlaceholderEvolutionUrl(tUrl) &&
            !(envEvolutionUrl && normalizeEvolutionUrl(tUrl) === DEFAULT_EVOLUTION_URL && envEvolutionUrl !== DEFAULT_EVOLUTION_URL)
          ) {
            evolutionUrl = tUrl;
          }
          if (!evolutionKey && tKey) {
            evolutionKey = tKey;
            dbKeyFound = tKey;
            keySource = 'db_loja';
          }
        }
      } catch (tErr) {}
    }
  } catch (e) {
    console.warn("[resolveEvolutionConfig] Erro ao buscar dados no Supabase:", e);
  }

  // 3. Prioriza variáveis de ambiente da Easypanel (EVOLUTION_API_URL / EVOLUTION_API_KEY)
  if (!evolutionUrl || isPlaceholderEvolutionUrl(evolutionUrl)) {
    evolutionUrl = envEvolutionUrl || DEFAULT_EVOLUTION_URL;
  }
  evolutionUrl = normalizeEvolutionUrl(evolutionUrl);

  const isSameAsEnvUrl = Boolean(envEvolutionUrl && evolutionUrl === envEvolutionUrl);
  const isCustomServer = Boolean(
    envEvolutionUrl ? evolutionUrl !== envEvolutionUrl : evolutionUrl !== DEFAULT_EVOLUTION_URL
  );

  let shouldSyncDbWithEnv = false;

  if (!evolutionKey && envEvolutionKey) {
    evolutionKey = envEvolutionKey;
    keySource = 'env';
  } else if (
    keySource === 'db_loja' &&
    isSameAsEnvUrl &&
    envEvolutionKey &&
    dbKeyFound &&
    dbKeyFound !== envEvolutionKey
  ) {
    // A loja usa a mesma URL base da Easypanel, mas tinha uma chave antiga no banco: usa a chave ativa da env e sincroniza o banco
    console.warn(
      `[resolveEvolutionConfig] Chave salva no banco para "${instanceName}" (${maskEvolutionKeyPreview(dbKeyFound)}) difere de EVOLUTION_API_KEY (${maskEvolutionKeyPreview(envEvolutionKey)}) para a mesma URL base (${evolutionUrl}). Usando chave ativa da env.`
    );
    evolutionKey = envEvolutionKey;
    keySource = 'env';
    shouldSyncDbWithEnv = true;
  }

  evolutionKey = sanitizeEvolutionApiKey(evolutionKey);
  if (!evolutionKey) {
    keySource = 'none';
  }

  return {
    tenantId,
    evolutionUrl,
    evolutionKey,
    instanceName,
    evoHeaders: buildEvolutionHeaders(evolutionKey),
    keySource,
    isCustomServer,
    envEvolutionUrl,
    envEvolutionKey,
    shouldSyncDbWithEnv,
  };
}

app.post("/api/v1/chat/instance/test-evolution", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const evoConfig = await resolveEvolutionConfig(tenantId, req.body);

    if (!evoConfig.evolutionUrl) {
      return res.status(200).json({ ok: false, error: "URL da Evolution API não informada." });
    }

    if (!evoConfig.evolutionKey) {
      return res.status(200).json({ ok: false, error: "Chave Global (AUTHENTICATION_API_KEY) da Evolution API não informada." });
    }

    // Se o usuário enviou explicitamente uma chave nova no body para testar, respeita essa chave no teste;
    // caso a chave tenha vindo do banco da loja, habilita fallback automático para EVOLUTION_API_KEY em caso de 401.
    const allowEnvFallback = evoConfig.keySource !== 'body';

    let testRes = await evolutionRequestWithFallback(
      evoConfig,
      '/instance/fetchInstances',
      {},
      7000,
      allowEnvFallback
    );

    // Fallback: se /fetchInstances não existir nesta versão da Evolution, testa /instance/connectionState/{instanceName}
    if (!testRes.ok && testRes.status === 404 && evoConfig.instanceName) {
      const fallbackRes = await evolutionRequestWithFallback(
        evoConfig,
        `/instance/connectionState/${encodeURIComponent(evoConfig.instanceName)}`,
        {},
        5000,
        allowEnvFallback
      );
      if (fallbackRes.ok || fallbackRes.status === 404) {
        testRes = fallbackRes;
      }
    }

    if (!testRes.ok) {
      if (testRes.status === 401 || testRes.status === 403) {
        const detail = formatEvolutionErrorDetail(testRes);
        return res.status(200).json({ 
          ok: false, 
          status: testRes.status,
          keySource: evoConfig.keySource,
          error: `Chave de API (AUTHENTICATION_API_KEY) não autorizada na Evolution API (HTTP ${testRes.status}): ${detail}`
        });
      }
      return res.status(200).json({
        ok: false,
        status: testRes.status,
        error: testRes.error || testRes.data?.error || testRes.data?.message || `Servidor da Evolution API inacessível em ${evoConfig.evolutionUrl}. Verifique a URL e a rede.`
      });
    }

    let instances: any[] = [];
    if (testRes.data) {
      instances = Array.isArray(testRes.data) ? testRes.data : (testRes.data?.instances || []);
    }

    let instanceExists = false;
    let instanceState = "disconnected";
    let instanceOwner = null;

    if (evoConfig.instanceName) {
      const matching = instances.find((i: any) => 
        (i.name === evoConfig.instanceName || i.instance?.instanceName === evoConfig.instanceName || i.instanceName === evoConfig.instanceName || i.id === evoConfig.instanceName)
      );
      if (matching) {
        instanceExists = true;
        instanceState = matching.connectionStatus || matching.state || matching.instance?.state || "disconnected";
        instanceOwner = matching.owner || matching.instance?.owner || null;
      }
    }

    return res.json({
      ok: true,
      evolutionUrl: evoConfig.evolutionUrl,
      instanceName: evoConfig.instanceName,
      keySource: evoConfig.keySource,
      keyPreview: maskEvolutionKeyPreview(evoConfig.evolutionKey),
      totalInstances: instances.length,
      instanceExists,
      instanceState,
      instanceOwner,
      message: `Conexão com a Evolution API estabelecida com sucesso! (${instances.length} instância(s) no servidor)`
    });
  } catch (error: any) {
    return res.status(200).json({ ok: false, error: error.message || "Erro ao testar conexão com Evolution API" });
  }
});

app.post("/api/v1/chat/instance/save-config", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;

    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const resolved = await resolveEvolutionConfig(tenantId, req.body);
    const isExclusiveSave = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    const explicitKey = extractOverrideApiKey(req.body);
    const targetInstanceName = resolved.instanceName;
    const normalizedUrl = resolved.evolutionUrl;
    const cleanKeyToSave = explicitKey || (resolved.keySource === 'env' ? resolved.evolutionKey : '');

    if (isExclusiveSave) {
      const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, targetInstanceName, inboxId);
      if (!safeCheck.ok) {
        return res.status(400).json({ success: false, error: safeCheck.error, instanceName: targetInstanceName });
      }
    }

    // 1. Procura registro existente por instance_name
    let existing: any = null;
    try {
      const { data } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', targetInstanceName)
        .maybeSingle();
      existing = data;
    } catch (e) {}

    // 2. Se não encontrou por instance_name (APENAS no modo compartilhado/store_*), tenta buscar pelo primeiro registro da loja
    if (!existing && !isExclusiveSave && !targetInstanceName.startsWith('inbox_')) {
      try {
        const { data: storeInstances } = await supabaseAdmin
          .from('whatsapp_instances')
          .select('id, instance_name')
          .eq('store_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(5);

        const nonExclusiveRow = (storeInstances || []).find((i: any) => !isExclusiveInstanceName(i.instance_name));
        if (nonExclusiveRow) {
          existing = nonExclusiveRow;
        }
      } catch (e) {}
    }

    const updatePayload: any = {
      store_id: tenantId,
      instance_name: targetInstanceName,
      evolution_url: normalizedUrl,
      updated_at: new Date().toISOString()
    };

    if (cleanKeyToSave) {
      updatePayload.evolution_key = cleanKeyToSave;
    }

    let savedId = existing?.id;

    try {
      if (existing) {
        await supabaseAdmin
          .from('whatsapp_instances')
          .update(updatePayload)
          .eq('id', existing.id);
      } else {
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from('whatsapp_instances')
          .insert({
            ...updatePayload,
            evolution_key: cleanKeyToSave || resolved.evolutionKey || null,
            status: 'DISCONNECTED'
          })
          .select('id')
          .maybeSingle();

        if (insErr) {
          console.warn("[SaveConfig Insert Warning]:", insErr.message);
        }
        savedId = inserted?.id;
      }
    } catch (dbErr: any) {
      console.warn("[SaveConfig DB Warning]:", dbErr.message);
    }

    // Se inboxId for especificado e a tabela inboxes existir, vincula a instância
    if (inboxId && savedId) {
      try {
        await supabaseAdmin
          .from('inboxes')
          .update({ whatsapp_instance_id: savedId })
          .eq('id', inboxId);
      } catch (e) {}
    }

    const activeKey = cleanKeyToSave || resolved.evolutionKey;

    return res.json({ 
      success: true, 
      evolutionUrl: normalizedUrl,
      hasKey: !!activeKey,
      keySource: explicitKey ? 'db_loja' : resolved.keySource,
      keyPreview: activeKey ? maskEvolutionKeyPreview(activeKey) : null,
      isCustomServer: resolved.isCustomServer,
      instanceName: targetInstanceName,
      message: "Configurações da Evolution salvas com sucesso!" 
    });
  } catch (err: any) {
    console.error("[SaveConfig Error]:", err);
    return res.status(500).json({ error: err.message || "Erro ao salvar configurações" });
  }
});

async function extractEvolutionQrCode(data: any): Promise<string | null> {
  if (!data) return null;

  // Se o data for uma string direta
  if (typeof data === 'string') {
    if (data.startsWith('data:image')) return data;
    if (data.length > 100 && !data.startsWith('2@')) return `data:image/png;base64,${data}`;
    if (data.startsWith('2@')) {
      try {
        return await QRCode.toDataURL(data, {
          width: 320,
          margin: 2,
          color: { dark: '#064e3b', light: '#ffffff' }
        });
      } catch (e) {}
    }
  }

  // 1. Extração de Base64 em múltiplos formatos da Evolution v1 e v2
  let rawBase64 = 
    data?.base64 || 
    data?.qrcode?.base64 || 
    data?.instance?.qrcode?.base64 ||
    data?.instance?.base64 ||
    data?.response?.qrcode?.base64 ||
    data?.response?.base64 ||
    (typeof data?.qrcode === 'string' && data.qrcode.length > 80 && !data.qrcode.startsWith('2@') ? data.qrcode : null);

  // 2. Extração de Raw Code (2@...) do Baileys para gerar o QR via QRCode.toDataURL
  const rawCode = 
    data?.code || 
    data?.qrcode?.code || 
    data?.instance?.qrcode?.code ||
    data?.instance?.code ||
    data?.response?.qrcode?.code ||
    data?.response?.code ||
    (typeof data?.qrcode === 'string' && data.qrcode.startsWith('2@') ? data.qrcode : null) ||
    (typeof data?.code === 'string' ? data.code : null);

  if (rawBase64 && typeof rawBase64 === 'string') {
    return rawBase64.startsWith('data:image') ? rawBase64 : `data:image/png;base64,${rawBase64}`;
  }

  if (rawCode && typeof rawCode === 'string') {
    try {
      return await QRCode.toDataURL(rawCode, {
        width: 320,
        margin: 2,
        color: { dark: '#064e3b', light: '#ffffff' }
      });
    } catch (e) {
      console.warn("[QRCode Generator Error]:", e);
    }
  }

  return null;
}

app.post("/api/v1/chat/instance/create", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const forceRecreate = Boolean(req.body.recreate || req.body.force);
    const isExclusiveCreate = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    if (!tenantId) return res.status(400).json({ success: false, error: "Tenant ID is required." });

    const evoConfig = await resolveEvolutionConfig(tenantId, req.body);
    const { evolutionUrl, instanceName } = evoConfig;

    if (isExclusiveCreate) {
      const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, instanceName, inboxId);
      if (!safeCheck.ok) {
        return res.status(400).json({
          success: false,
          error: safeCheck.error,
          instanceName,
          evolutionUrl,
        });
      }
    }

    if (!evolutionUrl || !evoConfig.evolutionKey) {
      return res.status(400).json({
        success: false,
        error: "Por favor, informe a Chave Global da Evolution API (AUTHENTICATION_API_KEY) para criar a instância automaticamente.",
        needsKey: true,
        evolutionUrl
      });
    }

    const webhookUrl = resolveChatWebhookUrl(req);
    const allowEnvFallback = evoConfig.keySource !== 'body' || !evoConfig.isCustomServer;

    let base64: string | null = null;
    let isConnected = false;
    let instanceConfirmed = false;
    let phoneNumber: string | null = null;
    let webhookResult: EvolutionWebhookRegistrationResult | null = null;
    let lastConnectError: string | null = null;
    let lastConnectStatus = 0;

    try {
      // Se solicitado recriação forçada, remove a instância anterior (404 é ignorado)
      if (forceRecreate) {
        console.log(`[Evolution API] Forçando recriação da instância "${instanceName}"...`);
        await evolutionRequestWithFallback(
          evoConfig,
          `/instance/delete/${encodeURIComponent(instanceName)}`,
          { method: "DELETE" },
          6000,
          allowEnvFallback
        ).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
      }

      // 1. Verificar se a instância já existe e está conectada
      let instanceNotFound = forceRecreate;
      if (!forceRecreate) {
        const stateRes = await evolutionRequestWithFallback(
          evoConfig,
          `/instance/connectionState/${encodeURIComponent(instanceName)}`,
          {},
          5000,
          allowEnvFallback
        );

        if (stateRes.status === 401 || stateRes.status === 403) {
          const detail = formatEvolutionErrorDetail(stateRes);
          return res.status(401).json({
            success: false,
            error: `Chave Global de API (AUTHENTICATION_API_KEY) rejeitada pela Evolution (HTTP ${stateRes.status}): ${detail}`,
            needsKey: true,
            evolutionStatus: stateRes.status,
            evolutionResponse: stateRes.data,
            instanceName,
            evolutionUrl,
          });
        }

        if (stateRes.status === 404) {
          instanceNotFound = true;
        } else if (stateRes.ok && stateRes.data) {
          instanceConfirmed = true;
          const rawState = stateRes.data?.instance?.state || stateRes.data?.state;
          if (rawState === "open") {
            isConnected = true;
            phoneNumber =
              stateRes.data?.instance?.owner?.split('@')[0] ||
              stateRes.data?.owner?.split('@')[0] ||
              null;
          }
        }
      }

      // 2. Se já existe mas não está conectada, tenta GET /instance/connect/{instanceName}
      if (!isConnected && !instanceNotFound) {
        const connectRes = await evolutionRequestWithFallback(
          evoConfig,
          `/instance/connect/${encodeURIComponent(instanceName)}`,
          {},
          6000,
          allowEnvFallback
        );

        if (connectRes.status === 404) {
          // Auto-criação ao receber 404 ("instance does not exist")
          console.log(`[Evolution API] /instance/connect retornou 404 para "${instanceName}". Executando criação limpa...`);
          instanceNotFound = true;
          instanceConfirmed = false;
        } else if (connectRes.status === 401 || connectRes.status === 403) {
          const detail = formatEvolutionErrorDetail(connectRes);
          return res.status(401).json({
            success: false,
            error: `Chave Global de API rejeitada pela Evolution ao conectar (HTTP ${connectRes.status}): ${detail}`,
            needsKey: true,
            evolutionStatus: connectRes.status,
            evolutionResponse: connectRes.data,
            instanceName,
            evolutionUrl,
          });
        } else if (connectRes.ok && connectRes.data) {
          instanceConfirmed = true;
          const cState = connectRes.data?.instance?.state || connectRes.data?.state;
          if (cState === "open") {
            isConnected = true;
          } else {
            base64 = await extractEvolutionQrCode(connectRes.data);
          }
        } else if (!connectRes.ok) {
          lastConnectStatus = connectRes.status;
          lastConnectError = formatEvolutionErrorDetail(connectRes);
        }
      }

      // 3. Etapa 1 da criação limpa: POST /instance/create SEM bloco webhook
      if (!isConnected && !base64 && (instanceNotFound || !instanceConfirmed)) {
        const createResult = await createEvolutionInstanceClean({ evoConfig });

        if (!createResult.ok) {
          const httpCode =
            createResult.status === 401 || createResult.status === 403
              ? 401
              : createResult.status === 502
                ? 502
                : 400;
          return res.status(httpCode).json({
            success: false,
            error: createResult.error,
            needsKey: createResult.status === 401 || createResult.status === 403,
            evolutionStatus: createResult.status,
            evolutionResponse: createResult.rawResponse,
            instanceName,
            evolutionUrl,
          });
        }

        instanceConfirmed = true;
        if (createResult.data) {
          const cState = createResult.data?.instance?.state || createResult.data?.state;
          if (cState === "open") {
            isConnected = true;
          } else {
            base64 = await extractEvolutionQrCode(createResult.data);
          }
        }
      }

      // 4. Busca garantida do QR Code via GET /instance/connect/{instanceName} (aguarda 1,5s, até 2 tentativas)
      if (!isConnected && !base64 && instanceConfirmed) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          const pollRes = await evolutionRequestWithFallback(
            evoConfig,
            `/instance/connect/${encodeURIComponent(instanceName)}`,
            {},
            6000,
            allowEnvFallback
          );

          if (pollRes.ok && pollRes.data) {
            const pState = pollRes.data?.instance?.state || pollRes.data?.state;
            if (pState === "open") {
              isConnected = true;
              break;
            }
            const pQr = await extractEvolutionQrCode(pollRes.data);
            if (pQr) {
              base64 = pQr;
              break;
            }
          } else if (pollRes.status === 404) {
            lastConnectStatus = 404;
            lastConnectError = formatEvolutionErrorDetail(pollRes);
            instanceConfirmed = false;
            break;
          } else {
            lastConnectStatus = pollRes.status;
            lastConnectError = formatEvolutionErrorDetail(pollRes);
          }
        }
      }

      // Se a instância não existe ou não retornou QR Code nem está conectada, INTERROMPE sem sucesso falso
      if (!instanceConfirmed || (!base64 && !isConnected)) {
        const extraDetail = lastConnectError
          ? ` (HTTP ${lastConnectStatus}: ${lastConnectError})`
          : '';
        return res.status(400).json({
          success: false,
          error: `A Evolution API não retornou o QR Code para "${instanceName}"${extraDetail}. Verifique a URL e a API Key da Evolution.`,
          evolutionStatus: lastConnectStatus || 400,
          instanceName,
          evolutionUrl,
        });
      }

      // 5. Etapa 2: Registra o Webhook SOMENTE DEPOIS de confirmar que a instância existe na Evolution
      webhookResult = await registerEvolutionWebhook({
        evolutionUrl: evoConfig.evolutionUrl,
        evolutionKey: evoConfig.evolutionKey,
        instanceName,
        webhookUrl,
        evoConfig,
      });

    } catch (evolutionError: any) {
      console.error("[Evolution API Error]:", evolutionError.message || evolutionError);
      return res.status(502).json({
        success: false,
        error: `Erro ao comunicar com a Evolution API (${evolutionUrl}): ${evolutionError.message}.`
      });
    }

    // Salvar no banco os dados atualizados e sincronizar Caixas de Entrada
    const isExclusiveConnect = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    try {
      const updateData: any = {
        store_id: tenantId,
        instance_name: instanceName,
        evolution_url: evoConfig.evolutionUrl,
        evolution_key: evoConfig.evolutionKey,
        updated_at: new Date().toISOString()
      };

      if (isConnected) {
        updateData.status = 'CONNECTED';
        if (phoneNumber) updateData.phone_number = phoneNumber;
      } else {
        updateData.status = 'QRCODE';
        if (base64) updateData.qrcode_base64 = base64;
      }

      const { data: existing } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', instanceName)
        .maybeSingle();

      let instId = existing?.id;

      if (existing) {
        await safeUpdateWhatsappInstance('id', existing.id, updateData, isConnected);
      } else {
        const { data: inserted } = await supabaseAdmin
          .from('whatsapp_instances')
          .insert(updateData)
          .select('id')
          .maybeSingle();
        if (inserted?.id) {
          instId = inserted.id;
          if (isConnected) {
            await safeUpdateWhatsappInstance('id', instId, { status: 'CONNECTED' }, true);
          }
        }
      }

      if (instId) {
        if (isConnected) {
          await syncStoreInboxesToConnectedInstance(tenantId, instId, {
            specificInboxId: inboxId,
            exclusive: isExclusiveConnect,
          });
        } else if (inboxId && isValidUuid(inboxId)) {
          try {
            await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: instId }).eq('id', inboxId);
          } catch (e) {}
        }
      }
    } catch (dbErr: any) {
      console.warn("[WhatsApp DB Warning]:", dbErr.message);
    }

    if (isConnected) {
      return res.json({
        success: true,
        status: 'CONNECTED',
        phoneNumber,
        phone_number: phoneNumber,
        instanceName,
        evolutionUrl: evoConfig.evolutionUrl,
        keySource: evoConfig.keySource,
        keyPreview: maskEvolutionKeyPreview(evoConfig.evolutionKey),
        isCustomServer: evoConfig.isCustomServer,
        isEvolutionLive: true,
        webhook: webhookResult
      });
    }

    return res.json({
      success: true,
      status: 'QRCODE',
      qrcodeBase64: base64,
      isEvolutionLive: true,
      instanceName,
      evolutionUrl: evoConfig.evolutionUrl,
      keySource: evoConfig.keySource,
      keyPreview: maskEvolutionKeyPreview(evoConfig.evolutionKey),
      isCustomServer: evoConfig.isCustomServer,
      webhook: webhookResult
    });

  } catch (error: any) {
    console.error("Erro ao criar instância Evolution API:", error.message || error);
    return res.status(500).json({ success: false, error: error.message || "Erro interno ao gerar QR Code" });
  }
});

app.get("/api/v1/chat/instance/status", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
    try {
        const tenantId = (req as any).tenantId || req.query.tenantId;
        const inboxId = req.query.inboxId as string;
        const isExclusiveStatus = req.query.exclusive === "true";
        const requestedInstanceName = typeof req.query.instanceName === "string" ? req.query.instanceName.trim() : undefined;
        if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });
        
        const evoConfig = await resolveEvolutionConfig(String(tenantId), {
          inboxId,
          exclusive: isExclusiveStatus,
          ...(requestedInstanceName ? { instanceName: requestedInstanceName } : {}),
        });
        const { evolutionUrl, instanceName } = evoConfig;

        const buildStatusMeta = () => ({
          instanceName,
          evolutionUrl: evoConfig.evolutionUrl,
          hasKey: !!evoConfig.evolutionKey,
          keySource: evoConfig.keySource,
          keyPreview: evoConfig.evolutionKey ? maskEvolutionKeyPreview(evoConfig.evolutionKey) : null,
          isCustomServer: evoConfig.isCustomServer,
          exclusive: isExclusiveStatus,
        });

        if (isExclusiveStatus) {
          const safeCheck = await assertSafeExclusiveInstanceTarget(String(tenantId), instanceName, inboxId);
          if (!safeCheck.ok) {
            return res.json({
              status: 'DISCONNECTED',
              ...buildStatusMeta(),
              instanceName: buildFallbackExclusiveInstanceName(inboxId),
            });
          }
        }

        // Se Evolution estiver configurada, consulta estado real com timeout
        if (evolutionUrl && evoConfig.evolutionKey) {
          try {
            const stateRes = await evolutionRequestWithFallback(
              evoConfig,
              `/instance/connectionState/${encodeURIComponent(instanceName)}`,
              {},
              3500,
              true
            );

            if (stateRes.status === 404) {
              return res.json({
                status: 'DISCONNECTED',
                ...buildStatusMeta(),
              });
            }
            if (stateRes.ok && stateRes.data) {
              const connectionState = stateRes.data?.instance?.state || stateRes.data?.state;
              if (connectionState === "open") {
                  const phoneNumber = stateRes.data?.instance?.owner?.split('@')[0] || stateRes.data?.owner?.split('@')[0] || null;
                  
                  const { data: existing } = await supabaseAdmin.from('whatsapp_instances').select('id').eq('instance_name', instanceName).maybeSingle();
                  let instId = existing?.id;

                  if (existing) {
                      await safeUpdateWhatsappInstance(
                        'id',
                        existing.id,
                        {
                          status: 'CONNECTED',
                          ...(phoneNumber ? { phone_number: phoneNumber } : {}),
                        },
                        true
                      );
                  } else {
                      const { data: inserted } = await supabaseAdmin.from('whatsapp_instances').insert({
                         store_id: tenantId,
                         instance_name: instanceName,
                         status: 'CONNECTED',
                         ...(phoneNumber ? { phone_number: phoneNumber } : {}),
                         evolution_url: evoConfig.evolutionUrl,
                         evolution_key: evoConfig.evolutionKey,
                         updated_at: new Date().toISOString()
                      }).select('id').maybeSingle();
                      if (inserted?.id) {
                        instId = inserted.id;
                        await safeUpdateWhatsappInstance('id', instId, { status: 'CONNECTED' }, true);
                      }
                  }

                  if (instId) {
                    await syncStoreInboxesToConnectedInstance(String(tenantId), instId, {
                      specificInboxId: inboxId,
                      exclusive: isExclusiveStatus,
                    });
                  }

                  return res.json({ 
                    status: 'CONNECTED', 
                    phoneNumber, 
                    phone_number: phoneNumber, 
                    ...buildStatusMeta(),
                  });
              } else {
                  const connectRes = await evolutionRequestWithFallback(
                    evoConfig,
                    `/instance/connect/${encodeURIComponent(instanceName)}`,
                    {},
                    3500,
                    true
                  );

                  let base64: string | null = null;
                  if (connectRes.ok && connectRes.data) {
                    base64 = await extractEvolutionQrCode(connectRes.data);
                  }

                  // Se não veio na resposta do connect, verifica se temos salvo no banco (do webhook)
                  if (!base64) {
                    try {
                      const { data: dbInst } = await supabaseAdmin.from('whatsapp_instances').select('*').eq('instance_name', instanceName).maybeSingle();
                      if (dbInst?.qrcode_base64 || dbInst?.qr_code_base64) {
                        base64 = dbInst.qrcode_base64 || dbInst.qr_code_base64;
                      }
                    } catch (e) {}
                  }

                  return res.json({ 
                    status: base64 ? 'QRCODE' : 'DISCONNECTED', 
                    qrcodeBase64: base64 || null, 
                    ...buildStatusMeta(),
                  });
              }
            }
          } catch (fetchErr: any) {
            // Continua para o fallback de banco abaixo
          }
        }

        // Fallback no banco de dados
        try {
          const { data: existing } = await supabaseAdmin.from('whatsapp_instances').select('*').eq('instance_name', instanceName).maybeSingle();
          if (existing) {
            const dbQr = existing.qrcode_base64 || existing.qr_code_base64 || null;
            const resolvedStatus = existing.status === 'CONNECTED' 
              ? 'CONNECTED' 
              : (dbQr ? 'QRCODE' : 'DISCONNECTED');

            return res.json({ 
              status: resolvedStatus,
              phoneNumber: existing.phone_number || null,
              phone_number: existing.phone_number || null,
              qrcodeBase64: resolvedStatus === 'CONNECTED' ? null : dbQr,
              ...buildStatusMeta(),
              hasKey: !!evoConfig.evolutionKey || !!sanitizeEvolutionApiKey(existing.evolution_key),
            });
          }
        } catch (dbErr) {}

        return res.json({ 
          status: 'DISCONNECTED', 
          ...buildStatusMeta(),
        });
    } catch(error: any) {
        return res.json({ status: 'DISCONNECTED' });
    }
});

app.post(["/api/v1/chat/instance/recreate", "/api/v1/chat/instance/restart"], requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const isRestartOnly = req.path.endsWith('/restart');
    const isExclusiveRecreate = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    if (!tenantId) return res.status(400).json({ success: false, error: "Tenant ID is required." });

    const evoConfig = await resolveEvolutionConfig(tenantId, req.body);
    const { evolutionUrl, instanceName } = evoConfig;

    if (isExclusiveRecreate) {
      const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, instanceName, inboxId);
      if (!safeCheck.ok) {
        return res.status(400).json({
          success: false,
          error: safeCheck.error,
          instanceName,
          evolutionUrl,
        });
      }
    }

    if (!evolutionUrl || !evoConfig.evolutionKey) {
      return res.status(400).json({
        success: false,
        error: "Configurações da Evolution API incompletas (URL ou API Key ausentes).",
        needsKey: !evoConfig.evolutionKey,
        evolutionUrl,
        instanceName,
      });
    }

    const webhookUrl = resolveChatWebhookUrl(req);
    const allowEnvFallback = evoConfig.keySource !== 'body' || !evoConfig.isCustomServer;
    let base64: string | null = null;
    let isConnected = false;
    let instanceConfirmed = false;
    let phoneNumber: string | null = null;
    let lastConnectStatus = 0;
    let lastConnectError: string | null = null;

    if (isRestartOnly) {
      console.log(`[Evolution API] Reiniciando instância "${instanceName}" em ${evolutionUrl}...`);
      const restartRes = await evolutionRequestWithFallback(
        evoConfig,
        `/instance/restart/${encodeURIComponent(instanceName)}`,
        { method: "PUT" },
        8000,
        allowEnvFallback
      );

      if (restartRes.status === 404) {
        console.log(`[Evolution API] /instance/restart retornou 404 para "${instanceName}". Executando criação limpa automática...`);
        const createResult = await createEvolutionInstanceClean({ evoConfig });
        if (!createResult.ok) {
          const httpCode = createResult.status === 401 || createResult.status === 403 ? 401 : createResult.status === 502 ? 502 : 400;
          return res.status(httpCode).json({
            success: false,
            error: createResult.error,
            needsKey: createResult.status === 401 || createResult.status === 403,
            evolutionStatus: createResult.status,
            evolutionResponse: createResult.rawResponse,
            instanceName,
            evolutionUrl,
          });
        }
        instanceConfirmed = true;
        if (createResult.data) {
          base64 = await extractEvolutionQrCode(createResult.data);
        }
      } else if (!restartRes.ok) {
        const detail = formatEvolutionErrorDetail(restartRes);
        const httpCode = restartRes.status === 401 || restartRes.status === 403 ? 401 : restartRes.status === 502 ? 502 : 400;
        return res.status(httpCode).json({
          success: false,
          error: `Falha ao reiniciar instância "${instanceName}" na Evolution API (HTTP ${restartRes.status}): ${detail}`,
          needsKey: restartRes.status === 401 || restartRes.status === 403,
          evolutionStatus: restartRes.status,
          evolutionResponse: restartRes.data ?? restartRes.rawText ?? null,
          instanceName,
          evolutionUrl,
        });
      } else {
        instanceConfirmed = true;
        if (restartRes.data) {
          const rState = restartRes.data?.instance?.state || restartRes.data?.state;
          if (rState === "open") {
            isConnected = true;
          } else {
            base64 = await extractEvolutionQrCode(restartRes.data);
          }
        }
      }
    } else {
      // 1. Deleta instância anterior na Evolution (404 é ignorado caso ainda não exista)
      console.log(`[Evolution API] Recriando instância do zero: "${instanceName}" em ${evolutionUrl}`);
      const delRes = await evolutionRequestWithFallback(
        evoConfig,
        `/instance/delete/${encodeURIComponent(instanceName)}`,
        { method: "DELETE" },
        6000,
        allowEnvFallback
      );

      if (delRes.status === 401 || delRes.status === 403) {
        const detail = formatEvolutionErrorDetail(delRes);
        return res.status(401).json({
          success: false,
          error: `Chave Global de API (AUTHENTICATION_API_KEY) rejeitada pela Evolution API (HTTP ${delRes.status}): ${detail}`,
          needsKey: true,
          evolutionStatus: delRes.status,
          evolutionResponse: delRes.data ?? delRes.rawText ?? null,
          instanceName,
          evolutionUrl,
        });
      }

      if (delRes.ok) {
        await new Promise((r) => setTimeout(r, 900));
      }

      // 2. Cria nova instância com payload limpo (NUNCA misturar webhook no /instance/create)
      const createResult = await createEvolutionInstanceClean({ evoConfig });

      if (!createResult.ok) {
        const httpCode =
          createResult.status === 401 || createResult.status === 403
            ? 401
            : createResult.status === 502
              ? 502
              : 400;
        return res.status(httpCode).json({
          success: false,
          error: createResult.error,
          needsKey: createResult.status === 401 || createResult.status === 403,
          evolutionStatus: createResult.status,
          evolutionResponse: createResult.rawResponse,
          instanceName,
          evolutionUrl,
        });
      }

      instanceConfirmed = true;
      if (createResult.data) {
        const cState = createResult.data?.instance?.state || createResult.data?.state;
        if (cState === "open") {
          isConnected = true;
        } else {
          base64 = await extractEvolutionQrCode(createResult.data);
        }
      }
    }

    // 3. Busca garantida do QR Code via GET /instance/connect/{instanceName} (aguarda 1,5s, até 2 tentativas)
    if (!isConnected && !base64 && instanceConfirmed) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        const cRes = await evolutionRequestWithFallback(
          evoConfig,
          `/instance/connect/${encodeURIComponent(instanceName)}`,
          {},
          6000,
          allowEnvFallback
        );

        if (cRes.status === 404) {
          // Se por qualquer motivo ainda deu 404, tenta auto-criação limpa uma vez
          console.warn(`[Evolution API] /instance/connect retornou 404 após criação para "${instanceName}". Tentando auto-criação...`);
          const retryCreate = await createEvolutionInstanceClean({ evoConfig });
          if (!retryCreate.ok) {
            return res.status(retryCreate.status === 401 || retryCreate.status === 403 ? 401 : 400).json({
              success: false,
              error: retryCreate.error,
              evolutionStatus: retryCreate.status,
              evolutionResponse: retryCreate.rawResponse,
              instanceName,
              evolutionUrl,
            });
          }
          if (retryCreate.data) {
            const qr = await extractEvolutionQrCode(retryCreate.data);
            if (qr) {
              base64 = qr;
              break;
            }
          }
          continue;
        }

        if (cRes.ok && cRes.data) {
          const cState = cRes.data?.instance?.state || cRes.data?.state;
          if (cState === "open") {
            isConnected = true;
            phoneNumber =
              cRes.data?.instance?.owner?.split('@')[0] ||
              cRes.data?.owner?.split('@')[0] ||
              null;
            break;
          }
          const qr = await extractEvolutionQrCode(cRes.data);
          if (qr) {
            base64 = qr;
            break;
          }
        } else {
          lastConnectStatus = cRes.status;
          lastConnectError = formatEvolutionErrorDetail(cRes);
        }
      }
    }

    // NUNCA retornar sucesso verde se não há QR Code nem conexão ativa
    if (!instanceConfirmed || (!base64 && !isConnected)) {
      const extraDetail = lastConnectError
        ? ` (HTTP ${lastConnectStatus}: ${lastConnectError})`
        : '';
      return res.status(400).json({
        success: false,
        error: `A instância "${instanceName}" foi criada, mas a Evolution API não retornou o QR Code${extraDetail}. Tente novamente em alguns segundos.`,
        evolutionStatus: lastConnectStatus || 400,
        instanceName,
        evolutionUrl,
      });
    }

    // 4. Etapa 2: Registra o Webhook SOMENTE DEPOIS de confirmar a existência da instância
    const webhookResult = await registerEvolutionWebhook({
      evolutionUrl: evoConfig.evolutionUrl,
      evolutionKey: evoConfig.evolutionKey,
      instanceName,
      webhookUrl,
      evoConfig,
    });

    // 5. Atualiza no banco (limpando QR codes quando CONNECTED e sincronizando inboxes da loja)
    try {
      const { data: upserted } = await supabaseAdmin.from('whatsapp_instances').upsert({
        store_id: tenantId,
        instance_name: instanceName,
        evolution_url: evoConfig.evolutionUrl,
        evolution_key: evoConfig.evolutionKey,
        status: isConnected ? 'CONNECTED' : 'QRCODE',
        qrcode_base64: isConnected ? null : (base64 || null),
        phone_number: isConnected ? phoneNumber : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'instance_name' }).select('id').maybeSingle();

      const instId = upserted?.id;
      if (instId) {
        if (isConnected) {
          await safeUpdateWhatsappInstance('id', instId, { status: 'CONNECTED' }, true);
          await syncStoreInboxesToConnectedInstance(tenantId, instId, {
            specificInboxId: inboxId,
            exclusive: isExclusiveRecreate,
          });
        } else if (inboxId && isValidUuid(inboxId)) {
          try {
            await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: instId }).eq('id', inboxId);
          } catch (e) {}
        }
      }
    } catch (e) {}

    if (isConnected) {
      return res.json({
        success: true,
        status: 'CONNECTED',
        phoneNumber,
        phone_number: phoneNumber,
        instanceName,
        evolutionUrl: evoConfig.evolutionUrl,
        keySource: evoConfig.keySource,
        keyPreview: maskEvolutionKeyPreview(evoConfig.evolutionKey),
        isCustomServer: evoConfig.isCustomServer,
        webhook: webhookResult
      });
    }

    return res.json({
      success: true,
      status: 'QRCODE',
      qrcodeBase64: base64,
      instanceName,
      evolutionUrl: evoConfig.evolutionUrl,
      keySource: evoConfig.keySource,
      keyPreview: maskEvolutionKeyPreview(evoConfig.evolutionKey),
      isCustomServer: evoConfig.isCustomServer,
      webhook: webhookResult
    });
  } catch (err: any) {
    console.error("[Evolution API Recreate/Restart Error]:", err);
    return res.status(500).json({ success: false, error: err.message || "Erro ao recriar instância" });
  }
});

app.post("/api/v1/chat/instance/configure-webhook", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "Tenant ID é obrigatório." });
    }

    const evoConfig = await resolveEvolutionConfig(tenantId, req.body);

    if (!evoConfig.evolutionUrl || !evoConfig.evolutionKey) {
      return res.status(400).json({
        ok: false,
        error: "Configure a URL e a Chave Global (AUTHENTICATION_API_KEY) da Evolution API antes de reconfigurar o webhook.",
        evolutionUrl: evoConfig.evolutionUrl,
        instanceName: evoConfig.instanceName,
      });
    }

    const webhookUrl = resolveChatWebhookUrl(req);
    const webhookResult = await registerEvolutionWebhook({
      evolutionUrl: evoConfig.evolutionUrl,
      evolutionKey: evoConfig.evolutionKey,
      instanceName: evoConfig.instanceName,
      webhookUrl,
      evoConfig,
    });

    return res.status(200).json({
      ok: webhookResult.ok,
      success: webhookResult.ok,
      instanceName: evoConfig.instanceName,
      evolutionUrl: evoConfig.evolutionUrl,
      webhook: webhookResult,
      message: webhookResult.ok
        ? `Webhook registrado com sucesso em "${evoConfig.instanceName}" (${webhookResult.formatUsed} · HTTP ${webhookResult.status}).`
        : undefined,
      error: webhookResult.ok
        ? undefined
        : `Falha ao registrar webhook em "${evoConfig.instanceName}": ${webhookResult.error}`,
    });
  } catch (err: any) {
    console.error("[Evolution Webhook Reconfigure Error]:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Erro interno ao reconfigurar webhook na Evolution API.",
    });
  }
});

app.post("/api/v1/chat/instance/confirm", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const phoneNumber = req.body.phoneNumber || "(11) 98765-4321";
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const { instanceName, evolutionUrl, evolutionKey } = await resolveEvolutionConfig(tenantId, req.body);

    const isExclusiveConfirm = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    if (isExclusiveConfirm) {
      const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, instanceName, inboxId);
      if (!safeCheck.ok) {
        return res.status(400).json({ success: false, error: safeCheck.error, instanceName });
      }
    }
    const { data: existing } = await supabaseAdmin.from('whatsapp_instances').select('id').eq('instance_name', instanceName).maybeSingle();
    let instId = existing?.id;

    if (existing) {
      await safeUpdateWhatsappInstance(
        'id',
        existing.id,
        {
          status: 'CONNECTED',
          phone_number: phoneNumber,
        },
        true
      );
    } else {
      const { data: inserted } = await supabaseAdmin.from('whatsapp_instances').insert({
        store_id: tenantId,
        instance_name: instanceName,
        status: 'CONNECTED',
        phone_number: phoneNumber,
        evolution_url: evolutionUrl,
        evolution_key: evolutionKey,
        updated_at: new Date().toISOString()
      }).select('id').maybeSingle();
      if (inserted?.id) {
        instId = inserted.id;
        await safeUpdateWhatsappInstance('id', instId, { status: 'CONNECTED' }, true);
      }
    }

    if (instId) {
      await syncStoreInboxesToConnectedInstance(tenantId, instId, {
        specificInboxId: inboxId,
        exclusive: isExclusiveConfirm,
      });
    }

    return res.json({ success: true, status: 'CONNECTED', phoneNumber, instanceName });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/chat/instance/disconnect", requireChatEnabled, requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const isExclusiveDisconnect = Boolean(req.body.exclusive === true || req.body.exclusive === "true");
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const evoConfig = await resolveEvolutionConfig(tenantId, req.body);

    if (isExclusiveDisconnect) {
      const safeCheck = await assertSafeExclusiveInstanceTarget(tenantId, evoConfig.instanceName, inboxId);
      if (!safeCheck.ok) {
        return res.status(400).json({
          success: false,
          error: safeCheck.error,
          instanceName: evoConfig.instanceName,
        });
      }
    }

    if (evoConfig.evolutionUrl && evoConfig.evolutionKey) {
      evolutionRequestWithFallback(
        evoConfig,
        `/instance/logout/${encodeURIComponent(evoConfig.instanceName)}`,
        { method: "DELETE" },
        3000,
        true
      ).catch(() => {});
    }

    // Update status in supabase for this specific instance (clearing both QR columns)
    try {
      await safeUpdateWhatsappInstance(
        'instance_name',
        evoConfig.instanceName,
        {
          status: 'DISCONNECTED',
          phone_number: null,
        },
        true
      );
    } catch (e) {}

    return res.json({ success: true, status: 'DISCONNECTED', instanceName: evoConfig.instanceName });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/whatsapp/instances", requireNonRestrictedChatAdmin, async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const cleanTenantId = tenantId.replace(/^store_/, '').replace(/^tenant_/, '');

    const { data, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .or(`store_id.eq.${cleanTenantId},store_id.eq.${tenantId},store_id.eq.store_${cleanTenantId}`)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return res.json({ data });
    }

    const instanceName = `store_${cleanTenantId.replace(/[^a-zA-Z0-9]/g,"").toLowerCase()}`;
    return res.json({
      data: [
        {
          id: `inst_${cleanTenantId}`,
          store_id: tenantId,
          instance_name: instanceName,
          status: "DISCONNECTED",
          phone_number: null
        }
      ]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper to get current or given date formatted as YYYY-MM-DD in America/Sao_Paulo timezone
function getSaoPauloDateString(dateInput: Date | string = new Date()): string {
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

// Helper function to handle daily welcome messages for first message of the day
async function handleDailyWelcomeMessage(storeId: string, conversation: any, instanceName?: string, incomingText?: string): Promise<boolean> {
  try {
    const rawId = String(storeId || '').trim();
    const cleanStoreId = rawId.replace(/^store_/, '').replace(/^inbox_/, '').replace(/^tenant_/, '');
    const cleanInst = instanceName ? instanceName.replace(/^store_/, '').replace(/^inbox_/, '') : '';
    const dashId = cleanStoreId.replace(/_/g, '-');
    const underId = cleanStoreId.replace(/-/g, '_');
    
    // Resolução segura e isolada do tenant aceitando ID textual da própria unidade ou da instância conectada
    let tenant: any = null;
    
    // 1. Busca estrita pela tabela whatsapp_instances quando instanceName é fornecido
    if (instanceName) {
      try {
        const { data: instList } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("store_id")
          .or(`instance_name.ilike.${instanceName},instance_name.ilike.${cleanInst}`)
          .limit(1);

        const instRow = instList?.[0];
        if (instRow?.store_id) {
          const targetStoreId = String(instRow.store_id).trim();
          const cleanTarget = targetStoreId.replace(/^store_/, '').replace(/^inbox_/, '');
          const cleanTargetDash = cleanTarget.replace(/_/g, '-');
          const { data: t } = await supabaseAdmin
            .from("tenants")
            .select("*")
            .or(`id.eq.${targetStoreId},id.eq.${cleanTarget},id.eq.${cleanTargetDash},slug.eq.${targetStoreId},slug.eq.${cleanTarget}`)
            .limit(1)
            .maybeSingle();
          tenant = t || { id: targetStoreId, name: targetStoreId, slug: cleanTarget };
        }
      } catch (instErr: any) {
        console.warn("[WelcomeMessage] Aviso ao consultar whatsapp_instances:", instErr.message);
      }
    }

    // 2. Busca direta na tabela tenants por ID ou Slug da própria drogaria
    if (!tenant) {
      try {
        const { data: directTenant } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .or(`id.eq.${rawId},id.eq.${cleanStoreId},id.eq.${dashId},slug.eq.${rawId},slug.eq.${cleanStoreId}`)
          .limit(1)
          .maybeSingle();
        if (directTenant) {
          tenant = directTenant;
        }
      } catch (e: any) {}
    }

    // 3. Se não encontrar o tenant específico, aborta o disparo para evitar misturar unidades
    if (!tenant) {
      console.warn(`[WelcomeMessage] Tenant não localizado de forma estrita para storeId="${storeId}" ou instanceName="${instanceName}". Disparo de boas-vindas cancelado.`);
      return false;
    }

    const isEnabled = Boolean(tenant.welcome_message_enabled ?? tenant.welcomemessageenabled ?? false);
    console.log(`[WEBHOOK] Verificando Saudação Automática para loja "${tenant.name}" (@${tenant.slug}): ${isEnabled ? 'ATIVADA' : 'DESATIVADA'}`);
    if (!isEnabled) {
      console.log(`[WEBHOOK] Saudação automática desativada nas configurações da loja "${tenant.name}".`);
      return false;
    }

    // Comparação precisa de virada de dia no fuso horário do Brasil (America/Sao_Paulo)
    const todayStr = getSaoPauloDateString(new Date()); // YYYY-MM-DD em BRT
    let lastWelcomeDate: string | null = null;
    try {
      const { data: convData } = await supabaseAdmin
        .from("chat_conversations")
        .select("last_welcome_sent_at")
        .eq("id", conversation.id)
        .maybeSingle();

      if (convData?.last_welcome_sent_at) {
        lastWelcomeDate = getSaoPauloDateString(convData.last_welcome_sent_at);
      }
    } catch (e: any) {
      console.warn("[WelcomeMessage] Aviso ao consultar last_welcome_sent_at:", e.message);
    }

    // Se a conversa já estiver em atendimento humano ou se a mensagem pedir balconista/atendente, NÃO enviar boas-vindas da IA!
    if (
      conversation?.is_bot_active === false ||
      conversation?.is_human_controlled === true ||
      conversation?.kanban_stage === "em_atendimento" ||
      conversation?.stage === "em_atendimento" ||
      conversation?.status === "human" ||
      conversation?.status === "human_takeover" ||
      (incomingText && detectHumanHandoffIntent(incomingText).isHumanRequested)
    ) {
      console.log(`[WelcomeMessage] Conversa ${conversation?.id} em atendimento humano ou pedido de balconista detectado. Omitindo boas-vindas.`);
      return false;
    }

    // Se a mensagem recebida for um resumo de pedido da Webloja, não envia boas-vindas para não sobrepor o pedido
    if (incomingText && isWeblojaOrderMessage(incomingText).isOrder) {
      console.log(`[WelcomeMessage] Mensagem identificada como pedido da Loja Online FarmaFlow. Omitindo mensagem de boas-vindas para a conversa ${conversation.id}.`);
      return false;
    }

    const isTest = incomingText?.trim().toLowerCase() === '#teste' || 
                   incomingText?.trim().toLowerCase() === '#teste-boas-vindas' ||
                   incomingText?.trim().toLowerCase() === '#teste-bv';

    if (isTest) {
      console.log(`[WelcomeMessage] Comando de teste detectado (${incomingText?.trim()}). Resetando registro de envio para a conversa ${conversation.id}...`);
      try {
        await supabaseAdmin
          .from("chat_conversations")
          .update({ last_welcome_sent_at: null })
          .eq("id", conversation.id);
      } catch (_) {}
    } else if (lastWelcomeDate && lastWelcomeDate === todayStr) {
      console.log(`[WEBHOOK] Boas-vindas diárias já enviadas hoje (${todayStr}) para a conversa ${conversation.id}.`);
      return false; // Já enviada hoje no fuso horário brasileiro
    }

    const nowIso = new Date().toISOString();
    try {
      await supabaseAdmin
        .from("chat_conversations")
        .update({ last_welcome_sent_at: nowIso })
        .eq("id", conversation.id);
    } catch (updateErr: any) {
      console.warn("[WelcomeMessage] Aviso ao atualizar last_welcome_sent_at:", updateErr.message);
    }

    let rawPhone = conversation.contact?.phone_number;
    if (!rawPhone) {
      try {
        const { data: contactData } = await supabaseAdmin
          .from("chat_contacts")
          .select("phone_number")
          .eq("id", conversation.contact_id)
          .maybeSingle();
        rawPhone = contactData?.phone_number;
      } catch (_) {}
    }

    if (!rawPhone) {
      console.warn("[WelcomeMessage] Telefone do contato não encontrado para conversa:", conversation.id);
      return false;
    }

    const cleanPhone = String(rawPhone).replace(/\D/g, '');
    if (!cleanPhone) return false;

    const storeName = tenant.nome_loja || tenant.name || "nossa farmácia";
    const customText = tenant.welcome_message_text || tenant.welcomemessagetext || `Olá! Sou o assistente virtual da ${storeName}. Em que posso te ajudar hoje?`;
    let storeLink = tenant.welcome_message_link || tenant.welcomemessagelink;
    if (!storeLink) {
      if (tenant.custom_domain) {
        storeLink = `https://${tenant.custom_domain.replace(/^https?:\/\//, '')}`;
      } else if (tenant.slug) {
        const cleanSubdomain = tenant.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        storeLink = `https://${cleanSubdomain}.farmaflow.online`;
      } else {
        storeLink = `https://${tenant.id}.farmaflow.online`;
      }
    }
    storeLink = storeLink.replace(/\/+$/, '');
    const freshStoreUrl = ensureStoreUrlCacheBuster(storeLink);
    const targetInstanceName = await evolutionApiService.resolveInstanceName(tenant.id, instanceName);

    // Extrair e remover qualquer URL do corpo da mensagem de boas-vindas
    const { mainText: cleanWelcomeText } = extractUrlAndCleanText(customText);
    let welcomeGreeting = formatToWhatsAppMarkdown(cleanWelcomeText.trim() || `Olá! Sou o assistente virtual da ${storeName}. Em que posso te ajudar hoje?`);

    // Incluir horário de funcionamento se configurado e ainda não citado no texto
    const operatingHours = tenant.horario_funcionamento || tenant.smart_banners?._regulatoryData?.horario_funcionamento;
    if (operatingHours && !welcomeGreeting.toLowerCase().includes("horário") && !welcomeGreeting.toLowerCase().includes("horario")) {
      welcomeGreeting += `\n\n🕒 *Horário de Funcionamento:* ${operatingHours}`;
    }
    welcomeGreeting = formatToWhatsAppMarkdown(welcomeGreeting);

    console.log(`[WelcomeMessage] Iniciando fluxo de boas-vindas em 2 balões para ${cleanPhone} via instância "${targetInstanceName}" (Loja: "${storeName}")...`);

    let dispatchSuccess = false;
    let dispatchResult: any = null;

    try {
      // 1. Enviar Balão 1 (Apenas texto de saudação e atendimento, SEM LINK, linkPreview: false)
      console.log(`[WelcomeMessage] Disparando Balão 1 (Apenas Texto) para ${cleanPhone} via instância "${targetInstanceName}"...`);
      const firstResult = await evolutionApiService.sendTextMessage(
        targetInstanceName,
        cleanPhone,
        welcomeGreeting,
        { delay: 1000, linkPreview: false }
      );

      if (!firstResult.success) {
        throw new Error(firstResult.error || "Falha ao enviar primeiro balão de boas-vindas");
      }

      // Registra TODOS os IDs possíveis do Balão 1 contra eco no webhook
      const b1Candidates = [
        firstResult.data?.key?.id,
        firstResult.data?.message?.key?.id,
        firstResult.data?.messages?.[0]?.key?.id,
        firstResult.data?.id,
        firstResult.data?.messageId,
        (firstResult as any).key?.id,
        (firstResult as any).id
      ].filter(Boolean);
      for (const id of b1Candidates) {
        botSentMessageIds.add(String(id).trim());
        registerBotSentMessage(String(id).trim(), conversation.id, cleanPhone);
      }

      // Grava Balão 1 no banco e transmite no WebSocket
      const welcomeMsgId1 = crypto.randomUUID();
      const welcomeMsg1 = {
        id: welcomeMsgId1,
        conversation_id: conversation.id,
        sender_type: "BOT",
        content: welcomeGreeting,
        is_private: false,
        created_at: nowIso
      };

      try {
        await supabaseAdmin.from("chat_messages").insert([welcomeMsg1]);
      } catch (dbErr: any) {
        console.warn("[WelcomeMessage] Erro ao persistir Balão 1 no banco:", dbErr.message);
      }

      realtimeHub.broadcastToStore(storeId, "chat_message", {
        conversationId: conversation.id,
        message: welcomeMsg1,
        conversation
      });

      // Delay de 1200ms para ordenação visual no WhatsApp
      await new Promise(resolve => setTimeout(resolve, 1200));

      // 2. Enviar Balão 2 (Apenas a URL pura com cache-buster e linkPreview: true para gerar a logo da farmácia)
      console.log(`[WelcomeMessage] Disparando Balão 2 (Apenas a URL Pura da Loja com Cache-Buster) para ${cleanPhone} via "${targetInstanceName}": ${freshStoreUrl}`);
      dispatchResult = await evolutionApiService.sendTextMessage(
        targetInstanceName,
        cleanPhone,
        freshStoreUrl,
        { delay: 1500, linkPreview: true }
      );

      dispatchSuccess = Boolean(dispatchResult?.success);

      if (dispatchSuccess) {
        // Registra TODOS os IDs possíveis do Balão 2 contra eco no webhook
        const b2Candidates = [
          dispatchResult.data?.key?.id,
          dispatchResult.data?.message?.key?.id,
          dispatchResult.data?.messages?.[0]?.key?.id,
          dispatchResult.data?.id,
          dispatchResult.data?.messageId,
          (dispatchResult as any).key?.id,
          (dispatchResult as any).id
        ].filter(Boolean);
        for (const id of b2Candidates) {
          botSentMessageIds.add(String(id).trim());
          registerBotSentMessage(String(id).trim(), conversation.id, cleanPhone);
        }

        const nowIso2 = new Date().toISOString();
        const welcomeMsgId2 = crypto.randomUUID();
        const welcomeMsg2 = {
          id: welcomeMsgId2,
          conversation_id: conversation.id,
          sender_type: "BOT",
          content: freshStoreUrl,
          is_private: false,
          created_at: nowIso2
        };

        try {
          await supabaseAdmin.from("chat_messages").insert([welcomeMsg2]);
          await supabaseAdmin.from("chat_conversations").update({
            last_message_at: nowIso2,
            last_message_content: freshStoreUrl,
            last_welcome_sent_at: nowIso2,
            bot_interaction_count: 0,
            is_bot_active: true,
            is_human_controlled: false,
            kanban_stage: "ia_atendendo",
            status: "bot",
            updated_at: nowIso2
          }).eq("id", conversation.id);

          conversation.last_message_at = nowIso2;
          conversation.last_message_content = freshStoreUrl;
          conversation.last_welcome_sent_at = nowIso2;
          conversation.bot_interaction_count = 0;
          conversation.is_bot_active = true;
          conversation.is_human_controlled = false;
          conversation.kanban_stage = "ia_atendendo";
          conversation.status = "bot";
        } catch (dbErr: any) {
          console.warn("[WelcomeMessage] Erro ao persistir Balão 2 no banco:", dbErr.message);
        }

        realtimeHub.broadcastToStore(storeId, "chat_message", {
          conversationId: conversation.id,
          message: welcomeMsg2,
          conversation
        });

        console.log(`[WelcomeMessage] ✅ Fluxo rigoroso de boas-vindas em 2 balões concluído com sucesso para ${cleanPhone} (Loja: "${tenant.name}", Instância: "${targetInstanceName}", Status: ENTREGUE)`);
        return true;
      }
    } catch (evoDispatchErr: any) {
      console.error(`[WelcomeMessage] [ERRO EVOLUTION] Falha crítica ao disparar mensagem para o WhatsApp do cliente (${cleanPhone}): ${evoDispatchErr.message || evoDispatchErr}`);
      dispatchSuccess = false;
    }

    console.error(`[WelcomeMessage] [ERRO EVOLUTION] Falha no envio para WhatsApp (${cleanPhone}): HTTP ${dispatchResult?.status || 500} - ${dispatchResult?.error || 'Erro desconhecido'}. Não inserindo no chat como entregue.`);
    
    // Reseta last_welcome_sent_at para permitir nova tentativa em mensagens futuras
    try {
      await supabaseAdmin
        .from("chat_conversations")
        .update({ last_welcome_sent_at: null })
        .eq("id", conversation.id);
    } catch (_) {}

    console.log(`[WelcomeMessage] Fluxo de boas-vindas concluído para ${cleanPhone} (Loja: "${tenant.name}", Instância: "${targetInstanceName}", Status: FALHA)`);
    return false;
  } catch (err: any) {
    console.error("[WelcomeMessage] Erro ao processar mensagem de boas-vindas:", err.message);
    return false;
  }
}

// =========================================================================
// TRAVAS CENTRALIZADAS DE AUTOMAÇÃO / IA NO WEBHOOK DO WHATSAPP
// =========================================================================
function parseTenantAiAgentConfig(tenant: any): Record<string, any> {
  let raw: any =
    tenant?.ai_agent_config ??
    tenant?.aiagentconfig ??
    tenant?.ai_agent_settings ??
    tenant?.ai_config ??
    null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

function resolveTenantAutomationFlags(tenant: any): {
  aiEnabled: boolean;
  welcomeEnabled: boolean;
  moduleAuthorized: boolean;
  agentConfigEnabled: boolean;
  reason: string;
} {
  if (!tenant) {
    return {
      aiEnabled: false,
      welcomeEnabled: false,
      moduleAuthorized: false,
      agentConfigEnabled: false,
      reason: "tenant_not_found",
    };
  }

  // Primeira mensagem do dia (Saudação Automática)
  const welcomeEnabled = Boolean(
    tenant.welcome_message_enabled ?? tenant.welcomemessageenabled ?? false
  );

  // Liberação do módulo de IA no Super Admin (precisa estar explicitamente true)
  const moduleAuthorized =
    tenant.is_ai_agent_enabled === true || tenant.isaiagentenabled === true;

  const cfg = parseTenantAiAgentConfig(tenant);
  // Precedência: `enabled` (chave principal salva pelo painel AiAgentSettings.tsx) > `active` (legado) > false
  const agentConfigEnabled =
    typeof cfg.enabled === "boolean"
      ? cfg.enabled
      : typeof cfg.active === "boolean"
        ? cfg.active
        : false;

  if (!moduleAuthorized) {
    return {
      aiEnabled: false,
      welcomeEnabled,
      moduleAuthorized,
      agentConfigEnabled,
      reason: "tenant_ai_module_disabled",
    };
  }

  if (!agentConfigEnabled) {
    return {
      aiEnabled: false,
      welcomeEnabled,
      moduleAuthorized,
      agentConfigEnabled,
      reason: "tenant_ai_agent_paused",
    };
  }

  return {
    aiEnabled: true,
    welcomeEnabled,
    moduleAuthorized,
    agentConfigEnabled,
    reason: "ai_enabled",
  };
}

function isConversationHumanOrPaused(
  conversation: any,
  isWeblojaOrder = false
): boolean {
  if (!conversation) return false;
  const convStatusLower = String(conversation.status || "").toLowerCase();
  const convStageLower = String(
    conversation.kanban_stage || conversation.stage || ""
  ).toLowerCase();

  return (
    isWeblojaOrder ||
    conversation.is_human_controlled === true ||
    conversation.is_bot_active === false ||
    (conversation as any).ai_enabled === false ||
    Boolean(conversation.assigned_user_id) ||
    Boolean((conversation as any).assigned_to) ||
    convStatusLower === "human" ||
    convStatusLower === "human_takeover" ||
    convStatusLower === "paused" ||
    convStatusLower === "closed" ||
    convStatusLower === "resolved" ||
    convStageLower === "em_atendimento"
  );
}

/**
 * Blindagem extra no envio de fallback de erro de transcrição de áudio:
 * SÓ permite enviar qualquer aviso/fallback se `aiEnabled === true` estiver
 * explicitamente confirmado para aquele `tenant_id` E a conversa NÃO estiver
 * em atendimento humano / pausada.
 */
async function sendAudioFallbackIfAiExplicitlyEnabled(params: {
  tenantId: string;
  tenant: any;
  conversation: any;
  instanceName?: string | null;
  cleanPhone?: string | null;
  messageText?: string;
  isWeblojaOrder?: boolean;
  persistInChat?: boolean;
}): Promise<{ sent: boolean; blocked: boolean; reason: string }> {
  const {
    tenantId,
    tenant,
    conversation,
    instanceName,
    cleanPhone,
    isWeblojaOrder = false,
    persistInChat = true,
  } = params;
  const messageText =
    params.messageText ||
    "Desculpe, não consegui entender o seu áudio com clareza. Você poderia digitar sua dúvida ou tentar mandar novamente?";

  // 1. Confirmação estrita da configuração de IA do tenant (com reconsulta no banco se necessário)
  let tenantToCheck = tenant;
  if (
    !tenantToCheck ||
    (tenantToCheck.is_ai_agent_enabled === undefined &&
      tenantToCheck.isaiagentenabled === undefined)
  ) {
    try {
      const { data: freshTenant } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .limit(1)
        .maybeSingle();
      if (freshTenant) tenantToCheck = freshTenant;
    } catch (_) {}
  }

  const { aiEnabled, reason: aiReason } = resolveTenantAutomationFlags(tenantToCheck);
  if (aiEnabled !== true) {
    console.log(
      `[WEBHOOK - AUDIO FALLBACK GUARD] 🔇 Envio de fallback de áudio BLOQUEADO: IA desligada (${aiReason}) para tenant="${tenantId}".`
    );
    return { sent: false, blocked: true, reason: aiReason };
  }

  // 2. Confirmação estrita de que a conversa não está em atendimento humano / pausada
  if (isConversationHumanOrPaused(conversation, isWeblojaOrder)) {
    console.log(
      `[WEBHOOK - AUDIO FALLBACK GUARD] 🔇 Envio de fallback de áudio BLOQUEADO: conversa ${conversation?.id} está em atendimento humano/pausada.`
    );
    return { sent: false, blocked: true, reason: "conversation_human_or_paused" };
  }

  if (conversation?.id) {
    try {
      const { data: freshConv } = await supabaseAdmin
        .from("chat_conversations")
        .select("is_bot_active, is_human_controlled, assigned_user_id, kanban_stage, stage, status")
        .eq("id", conversation.id)
        .limit(1)
        .maybeSingle();
      if (freshConv && isConversationHumanOrPaused(freshConv, isWeblojaOrder)) {
        console.log(
          `[WEBHOOK - AUDIO FALLBACK GUARD] 🔇 Envio de fallback de áudio BLOQUEADO (recheck DB): conversa ${conversation.id} em atendimento humano/pausada.`
        );
        return { sent: false, blocked: true, reason: "conversation_human_or_paused_db" };
      }
    } catch (_) {}
  }

  // 3. Disparo permitido apenas com aiEnabled === true e conversa ativa no bot
  if (cleanPhone && instanceName) {
    const sendFailRes = await evolutionApiService.sendTextMessage(
      instanceName,
      cleanPhone,
      messageText,
      { delay: 1000 }
    );
    const failId =
      sendFailRes?.data?.key?.id ||
      sendFailRes?.data?.message?.key?.id ||
      sendFailRes?.data?.id ||
      sendFailRes?.data?.messageId ||
      (sendFailRes as any)?.key?.id;
    registerBotSentMessage(failId, conversation?.id, cleanPhone);
  }

  if (persistInChat && conversation?.id) {
    const failMsgId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const failBotMsg = {
      id: failMsgId,
      conversation_id: conversation.id,
      sender_type: "BOT",
      content: messageText,
      media_url: null,
      media_type: null,
      created_at: nowIso,
    };

    try {
      await supabaseAdmin.from("chat_messages").insert([failBotMsg]);
      await supabaseAdmin
        .from("chat_conversations")
        .update({
          last_message_content: messageText,
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", conversation.id);

      realtimeHub.broadcastToStore(tenantId, "chat_message", {
        conversationId: conversation.id,
        message: failBotMsg,
        conversation,
      });
    } catch (dbFailErr: any) {
      console.warn(
        "[WEBHOOK - AUDIO] Erro ao registrar mensagem de erro amigável no banco:",
        dbFailErr.message
      );
    }
  }

  return { sent: true, blocked: false, reason: "sent_with_ai_enabled" };
}

// 1. Webhook Ultra-Leve para Evolution API (Serverless-friendly)
app.post("/api/v1/chat/webhook", requireChatEnabled, async (req, res) => {
  try {
    const { event, data, instance: bodyInstance } = req.body;
    
    // Log para diagnóstico de payload bruto (solicitado)
    console.log(`[Webhook RAW Payload] Evento: ${event}`, JSON.stringify(req.body, null, 2));
    
    // Captura prioritária e abrangente do instanceName (fonte única e canônica da conexão WhatsApp)
    const instanceName = bodyInstance || 
      data?.instance || 
      req.body?.instanceName || 
      data?.instanceName || 
      (typeof req.query.instance === 'string' ? req.query.instance : null) || 
      (typeof req.query.instanceName === 'string' ? req.query.instanceName : null);
    
    const rawTenantId = req.query.tenantId || req.query.storeId || req.body.tenantId;
    const sanitizedTenantId = typeof rawTenantId === 'string' ? rawTenantId.trim().replace(/^store_/, '') : rawTenantId;
    
    const eventName = String(event || "").toLowerCase();
    const eventNameUpper = String(event || "").toUpperCase();
    
    const isReactionEvent = (
      eventName.includes("reaction") || 
      eventNameUpper.includes("REACTION") ||
      Boolean(data?.reaction) ||
      Boolean(data?.message?.reactionMessage) ||
      Boolean(data?.reactionMessage)
    );

    let isMessageEvent = false;
    if (eventNameUpper === "MESSAGES_UPSERT" || eventName === "messages.upsert" || eventName === "messages-upsert" || isReactionEvent) {
      isMessageEvent = true;
    } else if (data?.messages || (data?.message && data.message.key) || data?.key) {
      isMessageEvent = true;
      console.log(`[Webhook Event] Evento não é explicitamente MESSAGES_UPSERT, mas contém payload de mensagem. Forçando processamento.`);
    }

    if (!isMessageEvent) {
      console.log(`[Webhook Event] Recebido evento: ${event || 'indefinido'}. Ignorando processamento de IA por não ser mensagem.`);
    }

    if (isMessageEvent) {
      let messages = [];
      if (Array.isArray(data?.messages)) {
        messages = data.messages;
      } else if (data?.message && data.message.key) {
        messages = [data.message];
      } else if (data?.key) {
        messages = [data]; // data is the message itself
      } else if (Array.isArray(data)) {
        messages = data;
      } else if (isReactionEvent && data) {
        messages = [data];
      }
      
      let resolvedTenant: any = null;
      let storeId = "";

      // 1. Busca Obrigatória e Dinâmica pela tabela whatsapp_instances usando o instanceName recebido da Evolution API
      if (instanceName) {
        const rawInst = String(instanceName).trim();
        const cleanInst = rawInst.replace(/^store_/, '').replace(/^inbox_/, '').replace(/^tenant_/, '').trim();
        const cleanInstDash = cleanInst.replace(/_/g, '-');
        const cleanInstUnderscore = cleanInst.replace(/-/g, '_');
        
        console.log(`[WEBHOOK INSTANCE QUERY] Iniciando busca em whatsapp_instances para instanceName: "${rawInst}" (clean: "${cleanInst}", dash: "${cleanInstDash}")`);

        try {
          // 1.1 Tentativa com busca case-insensitive exata na coluna instance_name
          let { data: instRow, error: instErr } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("id, store_id, instance_name, status, phone_number")
            .ilike("instance_name", rawInst)
            .limit(1)
            .maybeSingle();

          // 1.2 Se não encontrou, busca com variações tolerantes (com/sem prefixos, traços ou underscores)
          if (!instRow && !instErr) {
            const orFilter = [
              `instance_name.ilike.${rawInst}`,
              `instance_name.ilike.${cleanInst}`,
              `instance_name.ilike.${cleanInstDash}`,
              `instance_name.ilike.${cleanInstUnderscore}`,
              `instance_name.ilike.store_${cleanInst}`,
              `instance_name.ilike.inbox_${cleanInst}`,
              `store_id.eq.${rawInst}`,
              `store_id.eq.${cleanInst}`,
              `store_id.eq.${cleanInstDash}`
            ].join(',');

            const orRes = await supabaseAdmin
              .from("whatsapp_instances")
              .select("id, store_id, instance_name, status, phone_number")
              .or(orFilter)
              .limit(1)
              .maybeSingle();

            instRow = orRes.data;
            instErr = orRes.error;
          }

          console.log(`[WEBHOOK INSTANCE RESULT] Resultado da consulta em whatsapp_instances:`, instRow ? {
            id: instRow.id,
            store_id: instRow.store_id,
            instance_name: instRow.instance_name,
            status: instRow.status
          } : "Nenhum registro encontrado", instErr ? `Erro: ${instErr.message}` : "");

          if (instRow?.store_id) {
            const targetStoreId = String(instRow.store_id).trim();
            const cleanTargetStoreId = targetStoreId.replace(/^store_/, '').replace(/^inbox_/, '');
            const cleanTargetDash = cleanTargetStoreId.replace(/_/g, '-');

            // Busca na tabela tenants pelo ID da loja ou pelo slug
            const { data: tenantFromInst, error: tErr } = await supabaseAdmin
              .from("tenants")
              .select("*")
              .or(`id.eq.${targetStoreId},id.eq.${cleanTargetStoreId},id.eq.${cleanTargetDash},slug.eq.${targetStoreId},slug.eq.${cleanTargetStoreId},slug.eq.${cleanTargetDash}`)
              .limit(1)
              .maybeSingle();

            if (tenantFromInst) {
              resolvedTenant = tenantFromInst;
              console.log(`[WEBHOOK TENANT LOOKUP] Tenant localizado pelo store_id da instância: "${resolvedTenant.name}" (id: ${resolvedTenant.id}, slug: ${resolvedTenant.slug})`);
            } else {
              // Se não encontrou o registro completo na tabela tenants, usa o store_id da instância
              resolvedTenant = { id: targetStoreId, name: targetStoreId, slug: cleanTargetStoreId };
              console.warn(`[WEBHOOK TENANT LOOKUP] Registro não localizado em tenants, utilizando dados da instância: store_id="${targetStoreId}"`);
            }
          }
        } catch (instErr: any) {
          console.error('[WEBHOOK ERROR] Erro na consulta de whatsapp_instances:', instErr.message);
        }
      }

      // 2. Se NÃO havia instanceName no webhook, tenta pelo tenantId/storeId explicitamente informado nos parâmetros da requisição
      if (!resolvedTenant && !instanceName && (req.query.tenantId || req.query.storeId || req.body.tenantId)) {
        const explicitId = String(req.query.tenantId || req.query.storeId || req.body.tenantId).trim();
        const cleanExplicit = explicitId.replace(/^store_/, '').replace(/^inbox_/, '').replace(/^tenant_/, '');
        const cleanExplicitDash = cleanExplicit.replace(/_/g, '-');

        try {
          const { data: byIdOrSlug } = await supabaseAdmin
            .from("tenants")
            .select("*")
            .or(`id.eq.${explicitId},id.eq.${cleanExplicit},id.eq.${cleanExplicitDash},slug.eq.${explicitId},slug.eq.${cleanExplicit},slug.eq.${cleanExplicitDash}`)
            .limit(1)
            .maybeSingle();

          if (byIdOrSlug) {
            resolvedTenant = byIdOrSlug;
            console.log(`[WEBHOOK TENANT LOOKUP] Tenant localizado por parâmetro explícito: "${resolvedTenant.name}" (id: ${resolvedTenant.id})`);
          }
        } catch (paramErr: any) {
          console.error('[WEBHOOK ERROR] Erro ao buscar tenant explícito:', paramErr.message);
        }
      }

      // 3. Fallback tolerante direto na tabela tenants pelo instanceName caso a instância não esteja cadastrada em whatsapp_instances
      if (!resolvedTenant && instanceName) {
        const cleanInst = String(instanceName).trim().replace(/^store_/, '').replace(/^inbox_/, '').replace(/^tenant_/, '');
        const cleanInstDash = cleanInst.replace(/_/g, '-');
        const cleanInstUnder = cleanInst.replace(/-/g, '_');
        
        try {
          const { data: fallbackTenant } = await supabaseAdmin
            .from("tenants")
            .select("*")
            .or(`id.eq.${cleanInst},id.eq.${cleanInstDash},id.eq.${cleanInstUnder},slug.eq.${cleanInst},slug.eq.${cleanInstDash}`)
            .limit(1)
            .maybeSingle();

          if (fallbackTenant) {
            resolvedTenant = fallbackTenant;
            console.log(`[WEBHOOK FALLBACK TENANT] Tenant mapeado diretamente por slug/id da instância: "${resolvedTenant.name}" (id: ${resolvedTenant.id})`);
            
            // Auto-registro dinâmico da instância na tabela whatsapp_instances (Plug-and-Play)
            try {
              const rawInst = String(instanceName).trim();
              const { data: autoUpserted } = await supabaseAdmin.from("whatsapp_instances").upsert({
                store_id: fallbackTenant.id,
                instance_name: rawInst,
                status: "CONNECTED",
                updated_at: new Date().toISOString()
              }, { onConflict: "instance_name" }).select("id, store_id").maybeSingle();
              if (autoUpserted?.id) {
                await safeUpdateWhatsappInstance("id", autoUpserted.id, { status: "CONNECTED" }, true);
                await syncStoreInboxesToConnectedInstance(autoUpserted.store_id || fallbackTenant.id, autoUpserted.id);
              }
              console.log(`[WEBHOOK AUTO-REGISTRATION] Instância "${rawInst}" auto-registrada para a drogaria "${fallbackTenant.name}"`);
            } catch (autoRegErr: any) {
              console.warn("[WEBHOOK AUTO-REGISTRATION] Aviso ao auto-registrar instância:", autoRegErr.message);
            }
          }
        } catch (fbErr: any) {
          console.warn("[WEBHOOK FALLBACK WARNING] Erro na busca direta de fallback em tenants:", fbErr.message);
        }
      }

      // 4. Se a instância ou loja não for encontrada no banco, registra erro claro e NÃO processa mensagem
      if (!resolvedTenant) {
        console.error(`[WEBHOOK UNMAPPED INSTANCE] Instância não encontrada ou não cadastrada no sistema (instanceName: "${instanceName || 'indefinido'}", rawTenantId: "${rawTenantId || 'indefinido'}").`);
        return res.status(404).json({
          error: "Instância não vinculada a nenhuma drogaria cadastrada",
          instance: instanceName || null,
          tenantId: rawTenantId || null,
          hint: "Conecte ou cadastre a instância no painel da drogaria correspondente para ativar o atendimento automático."
        });
      }

      storeId = resolvedTenant.id;
      const tenantAutomation = resolveTenantAutomationFlags(resolvedTenant);
      console.log(
        `[WEBHOOK SUCCESS] Instância identificada com sucesso: "${instanceName || 'N/A'}" | Loja: "${resolvedTenant.name || resolvedTenant.slug || storeId}" (id: "${storeId}") | ` +
        `IA: ${tenantAutomation.aiEnabled ? 'LIGADA' : `DESLIGADA (${tenantAutomation.reason})`} | Boas-vindas: ${tenantAutomation.welcomeEnabled ? 'LIGADA' : 'DESLIGADA'} | Mensagens: ${messages.length}`
      );

      for (const msg of messages) {
        if (!msg) continue;
        
        const fromMe = Boolean(msg.key?.fromMe ?? msg.fromMe ?? false);
        const remoteJid = msg.key?.remoteJid || msg.remoteJid || msg.sender || msg.participant || "";
        if (!remoteJid || remoteJid.includes("@g.us") || remoteJid === "status@broadcast") continue; // Ignora mensagens de grupo e status

        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     msg.message?.videoMessage?.caption || 
                     msg.text || 
                     msg.body || 
                     (msg.message?.imageMessage ? "[Imagem]" : 
                     (msg.message?.videoMessage ? "[Vídeo]" : 
                     (msg.message?.audioMessage ? "[Áudio]" : 
                     (msg.message?.documentMessage ? "[Documento]" : 
                     (msg.message?.stickerMessage ? "[Figurinha]" : "[Mensagem WhatsApp]")))));

        const messageType = String(
          msg.messageType || 
          msg.type || 
          (msg.message?.audioMessage ? 'audioMessage' :
           msg.message?.imageMessage ? 'imageMessage' :
           msg.message?.documentMessage ? 'documentMessage' :
           msg.message?.videoMessage ? 'videoMessage' :
           msg.message?.stickerMessage ? 'stickerMessage' : 'conversation')
        ).toLowerCase();

        const mimetype = String(
          msg.mimetype || 
          msg.message?.audioMessage?.mimetype || 
          msg.message?.imageMessage?.mimetype || 
          msg.message?.documentMessage?.mimetype || 
          msg.data?.message?.audioMessage?.mimetype ||
          ''
        ).toLowerCase();

        const isAudio = 
          messageType === 'audiomessage' ||
          messageType === 'ptt' ||
          messageType === 'audio' ||
          Boolean(msg.message?.audioMessage) ||
          Boolean(msg.data?.message?.audioMessage) ||
          mimetype.startsWith('audio/');

        const isDocumentOrImage = 
          !isAudio && (
            messageType === 'imagemessage' ||
            messageType === 'documentmessage' ||
            Boolean(msg.message?.imageMessage) ||
            Boolean(msg.message?.documentMessage) ||
            mimetype.startsWith('image/') ||
            mimetype.startsWith('application/pdf')
          );

        let effectiveText = typeof text === "string" ? text : "";
        let isAudioMessage = isAudio;

        console.log(`[WEBHOOK] Mensagem de: ${remoteJid} | fromMe: ${fromMe} | isAudio: ${isAudio} | isDocImg: ${isDocumentOrImage} | Texto: "${typeof text === 'string' ? text.slice(0, 50) : ''}"`);

        try {
          // 1. SEMPRE salva primeiro a mensagem no banco de dados e cria/atualiza o contato e a conversa na caixa de entrada
          const result = await chatStore.processWhatsAppMessage(storeId, msg, instanceName);

          if (result && result.conversation) {
            const conversation = result.conversation;
            const wasReopened = Boolean((conversation as any)._was_reopened);
            const isWeblojaOrder = Boolean((conversation as any)._is_webloja_order);

            // 2. Broadcast IMEDIATO via WebSockets/Realtime para que apareça na tela do operador humano
            try {
              realtimeHub.broadcastToStore(storeId, "chat_message", {
                conversationId: conversation.id,
                message: result.message,
                conversation: conversation
              });

              // Se for pedido finalizado da Loja Online, emite evento de movimentação automática para "saiu_entrega" (Em Separação / Delivery)
              if (isWeblojaOrder) {
                console.log(`[WEBHOOK - WEBLOJA ORDER] 🛒 Pedido da loja online detectado na conversa ${conversation.id}. Emitindo evento de movimentação para "saiu_entrega" (Em Separação / Delivery) e desativando IA.`);
                realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
                  conversationId: conversation.id,
                  stage: "saiu_entrega",
                  kanban_stage: "saiu_entrega",
                  status: "em_separacao",
                  is_bot_active: false,
                  is_human_controlled: true,
                  assigned_user_id: conversation.assigned_user_id,
                  bot_handoff_reason: "WEBLOJA_ORDER_RECEIVED",
                  updated_at: conversation.updated_at || new Date().toISOString()
                });

                realtimeHub.broadcastToStore(storeId, "conversation_bot_toggled", {
                  conversationId: conversation.id,
                  is_bot_active: false,
                  is_human_controlled: true,
                  status: "em_separacao",
                  kanban_stage: "saiu_entrega"
                });

                realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
                  conversationId: conversation.id,
                  status: "em_separacao",
                  is_bot_active: false,
                  is_human_controlled: true,
                  kanban_stage: "saiu_entrega",
                  bot_handoff_reason: "WEBLOJA_ORDER_RECEIVED"
                });
              } else if (wasReopened) {
                // Se a conversa foi reaberta de um estágio finalizado, notifica a mudança de estágio para o Kanban atualizar em tempo real
                realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
                  conversationId: conversation.id,
                  stage: conversation.kanban_stage || "novos_triagem",
                  kanban_stage: conversation.kanban_stage || "novos_triagem",
                  status: conversation.status || "OPEN",
                  is_bot_active: conversation.is_bot_active,
                  is_human_controlled: conversation.is_human_controlled,
                  assigned_user_id: conversation.assigned_user_id,
                  updated_at: conversation.updated_at || new Date().toISOString()
                });
              }
            } catch (wsErr: any) {
              console.warn("[WEBHOOK] Aviso no broadcast realtime da mensagem recebida:", wsErr.message);
            }

            if (!fromMe) {
              // Log de Diagnóstico
              console.log(`[Webhook Message] Recebida msg de ${remoteJid}. is_bot_active: ${conversation.is_bot_active}, is_human_controlled: ${conversation.is_human_controlled}, is_webloja_order: ${isWeblojaOrder}, aiEnabled: ${tenantAutomation.aiEnabled}, welcomeEnabled: ${tenantAutomation.welcomeEnabled}`);

              // 3. Processamento CSAT isolado (apenas gravação em banco, sem envio de WhatsApp)
              try {
                const ratingNum = parseInt(String(effectiveText || text).trim(), 10);
                if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
                  await csatManager.recordCsatResponse(storeId, conversation.id, ratingNum);
                }
              } catch (csatErr: any) {
                console.warn("[WEBHOOK] Aviso ao processar CSAT:", csatErr.message);
              }

              // =========================================================================
              // 4. TRAVA CENTRALIZADA (EARLY RETURN) ANTES DE TRANSCRIÇÃO, PRESENÇA OU IA
              // =========================================================================
              // a) Conversa em atendimento humano / pausada / pedido da loja online
              const isHumanControlled = isConversationHumanOrPaused(conversation, isWeblojaOrder);
              if (isHumanControlled) {
                console.log(`[WEBHOOK - GUARD] 🔇 Silêncio Absoluto: Conversa ${conversation.id} está em atendimento humano/pausada (is_bot_active: ${conversation.is_bot_active}, is_human_controlled: ${conversation.is_human_controlled}, status: ${conversation.status}, stage: ${conversation.kanban_stage}). Encerrando sem transcrever áudio nem disparar IA.`);
                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'human_controlled' });
                }
                continue;
              }

              // b) Agente de IA DESLIGADO e Primeira Mensagem do Dia DESLIGADA
              if (!tenantAutomation.aiEnabled && !tenantAutomation.welcomeEnabled) {
                console.log(`[WEBHOOK - GUARD] 🔇 Automação desativada para loja "${resolvedTenant.name}" (${storeId}): IA=${tenantAutomation.reason}, Boas-vindas=false. Mensagem salva na caixa de entrada; encerrando imediatamente sem transcrever áudio nem enviar fallback.`);
                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'automation_disabled', reason: tenantAutomation.reason });
                }
                continue;
              }

              // c) Agente de IA DESLIGADO, mas Primeira Mensagem do Dia HABILITADA:
              //    NUNCA transcreve áudio nem envia fallback de áudio; apenas dispara a saudação diária (se aplicável hoje) e encerra.
              if (!tenantAutomation.aiEnabled && tenantAutomation.welcomeEnabled) {
                let welcomeOnlySent = false;
                if (!detectHumanHandoffIntent(effectiveText).isHumanRequested) {
                  try {
                    welcomeOnlySent = await handleDailyWelcomeMessage(storeId, conversation, instanceName, effectiveText);
                  } catch (welcomeErr: any) {
                    console.error('[WEBHOOK] Exceção ao processar boas-vindas diárias (modo IA desligada):', welcomeErr.message);
                  }
                }
                console.log(`[WEBHOOK - GUARD] 🔇 IA desligada (${tenantAutomation.reason}) para loja "${resolvedTenant.name}". Boas-vindas enviadas: ${welcomeOnlySent}. Encerrando sem transcrever áudio nem chamar IA.`);
                if (!res.headersSent) {
                  return res.status(200).json({
                    success: true,
                    handled: welcomeOnlySent ? 'welcome_message_only' : 'ai_disabled_welcome_skipped',
                    reason: tenantAutomation.reason
                  });
                }
                continue;
              }

              // =========================================================================
              // A PARTIR DESTE PONTO: tenantAutomation.aiEnabled === true E !isHumanControlled
              // =========================================================================
              const phone = conversation.contact?.phone_number || msg.key?.remoteJid?.replace(/@.*$/, '') || remoteJid.replace(/@.*$/, '');
              const cleanPhone = String(phone || '').replace(/\D/g, '');

              // 4.1. Transcrição de áudio (SOMENTE quando IA está explicitamente LIGADA e conversa ativa no bot)
              if (isAudio && result?.message) {
                try {
                  let audioData: string | null = null;
                  
                  const directBase64 = 
                    msg.base64 || 
                    msg.message?.audioMessage?.base64 || 
                    msg.data?.base64 ||
                    msg.data?.message?.audioMessage?.base64 ||
                    (typeof result?.message?.media_url === 'string' && result.message.media_url.length > 50 ? result.message.media_url : null) ||
                    (typeof result?.message?.mediaUrl === 'string' && result.message.mediaUrl.length > 50 ? result.message.mediaUrl : null);

                  console.log('[AUDIO_DEBUG] Tentando obter base64 da mensagem...', msg.key?.id || msg.id);

                  if (directBase64) {
                    audioData = directBase64;
                    console.log('[AUDIO_DEBUG] Base64 obtido com sucesso direto do payload! Tam:', audioData?.length);
                  } else {
                    audioData = await evolutionApiService.getBase64FromMediaMessage(instanceName, msg);
                    console.log('[AUDIO_DEBUG] Base64 obtido com sucesso da Evolution API? Tam:', audioData?.length);
                  }

                  if (!audioData) {
                    console.error('[AUDIO_DEBUG] ❌ Não foi possível obter o Base64 do áudio nem do payload nem da Evolution API.');
                  }

                  let transcribed: string | null = null;
                  if (audioData) {
                    const tenantAiCfg = parseTenantAiAgentConfig(resolvedTenant);
                    const tenantSettings = (resolvedTenant as any)?.settings || {};
                    const openAiKey = 
                      tenantAiCfg.openai_api_key ||
                      tenantSettings.openai_api_key ||
                      (resolvedTenant as any)?.openai_api_key ||
                      (tenantAiCfg.apiKey?.startsWith('sk-') ? tenantAiCfg.apiKey : undefined) ||
                      (tenantAiCfg.provider === 'openai' ? (tenantAiCfg.apiKey || tenantAiCfg.api_key) : undefined) ||
                      process.env.OPENAI_API_KEY;

                    console.log('[AUDIO_DEBUG] [server.ts] OpenAI Key encontrada para tenant:', resolvedTenant?.slug || resolvedTenant?.id, Boolean(openAiKey), 'Tam:', openAiKey?.length);

                    transcribed = await transcribeAudio({
                      audioBase64OrUrl: audioData,
                      mimeType: mimetype || "audio/ogg; codecs=opus",
                      apiKey: openAiKey,
                      openaiApiKey: openAiKey,
                      tenantConfig: tenantAiCfg,
                      tenant: resolvedTenant
                    });
                  }

                  if (transcribed && transcribed.trim().length > 0) {
                    effectiveText = transcribed.trim();
                    const audioDisplay = `🎤 [Áudio]: "${effectiveText}"`;
                    console.log(`[AUDIO_DEBUG] Transcrição Whisper com sucesso: "${effectiveText}"`);

                    try {
                      await supabaseAdmin
                        .from("chat_messages")
                        .update({ content: audioDisplay })
                        .eq("id", result.message.id);

                      await supabaseAdmin
                        .from("chat_conversations")
                        .update({
                          last_message_content: audioDisplay,
                          updated_at: new Date().toISOString()
                        })
                        .eq("id", conversation.id);

                      conversation.last_message_content = audioDisplay;
                      result.message.content = audioDisplay;
                    } catch (dbAudioErr: any) {
                      console.warn("[WEBHOOK - AUDIO] Erro ao atualizar transcrição no banco:", dbAudioErr.message);
                    }

                    realtimeHub.broadcastToStore(storeId, "chat_message", {
                      conversationId: conversation.id,
                      message: { ...result.message, content: audioDisplay },
                      conversation
                    });
                  } else {
                    console.warn(`[AUDIO_DEBUG] ⚠️ Transcrição do áudio falhou ou retornou vazia para ${remoteJid}. Acionando helper blindado de fallback.`);
                    const fbRes = await sendAudioFallbackIfAiExplicitlyEnabled({
                      tenantId: storeId,
                      tenant: resolvedTenant,
                      conversation,
                      instanceName,
                      cleanPhone,
                      isWeblojaOrder,
                      persistInChat: true
                    });

                    if (!res.headersSent) {
                      return res.status(200).json({
                        success: true,
                        handled: fbRes.sent ? 'audio_transcription_failed_friendly_replied' : 'audio_transcription_failed_silenced'
                      });
                    }
                    continue;
                  }
                } catch (audioErr: any) {
                  console.error("[WEBHOOK - AUDIO] Erro na transcrição de áudio:", audioErr.message);
                  const fbRes = await sendAudioFallbackIfAiExplicitlyEnabled({
                    tenantId: storeId,
                    tenant: resolvedTenant,
                    conversation,
                    instanceName,
                    cleanPhone,
                    isWeblojaOrder,
                    persistInChat: true
                  });

                  if (!res.headersSent) {
                    return res.status(200).json({
                      success: true,
                      handled: fbRes.sent ? 'audio_error_friendly_replied' : 'audio_error_silenced'
                    });
                  }
                  continue;
                }
              }

              // =========================================================================
              // 5. DEBOUNCE RESILIENTE A SERVERLESS (Vercel / Multi-Instância)
              // =========================================================================
              const currentMessage = result.message;
              const currentMsgTimestamp = currentMessage?.created_at || new Date().toISOString();

              // a) Atualiza timestamp da última mensagem na conversa
              try {
                const lastMsgToSave = typeof effectiveText === 'string' && effectiveText.length > 0 ? effectiveText.slice(0, 500) : (typeof text === 'string' ? text.slice(0, 500) : text);
                await supabaseAdmin
                  .from("chat_conversations")
                  .update({
                    last_message_at: currentMsgTimestamp,
                    last_message_content: lastMsgToSave,
                    updated_at: currentMsgTimestamp
                  })
                  .eq("id", conversation.id);
              } catch (updateConvErr: any) {
                console.warn("[WEBHOOK DEBOUNCE] Aviso ao atualizar last_message_at:", updateConvErr.message);
              }

              // b) Envia imediatamente status "composing" (digitando...) para a Evolution API
              if (instanceName && cleanPhone) {
                evolutionApiService.sendPresence(instanceName, cleanPhone, "composing", 2500).catch(err => {
                  console.warn("[WEBHOOK PRESENCE] Falha ao enviar presença composing:", err.message);
                });
              }

              // Se o cliente pediu para falar com balconista/atendente, fazemos o transbordo em 1.5s sem esperar 20s!
              const immediateHandoffAsked = detectHumanHandoffIntent(String(effectiveText || text || "")).isHumanRequested;
              const debounceWaitMs = immediateHandoffAsked ? 1500 : 20000;

              // c) Aguarda janela de tolerância de digitação (1.5s para pedido de balconista ou 20s normal)
              console.log(`[WEBHOOK DEBOUNCE] ⏳ Janela de ${debounceWaitMs / 1000}s iniciada para msg ${currentMessage?.id} na conversa ${conversation.id}...`);
              await new Promise(resolve => setTimeout(resolve, debounceWaitMs));

              // d) Verificação de Última Mensagem no Supabase (Evita disparos concorrentes no Serverless)
              if (!immediateHandoffAsked) {
                try {
                  const { data: latestMsg } = await supabaseAdmin
                    .from('chat_messages')
                    .select('id, created_at')
                    .eq('conversation_id', conversation.id)
                    .in('sender_type', ['CUSTOMER', 'CLIENT'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                  if (latestMsg && currentMessage && latestMsg.id !== currentMessage.id) {
                    console.log(`[WEBHOOK DEBOUNCE] ⏩ Mensagem mais recente detectada (${latestMsg.id} vs atual ${currentMessage.id}). Descartando execução desta requisição para consolidar na mais recente.`);
                    return res.status(200).json({ handled: 'debounced_by_newer_message', latestMessageId: latestMsg.id });
                  }
                } catch (checkErr: any) {
                  console.warn("[WEBHOOK DEBOUNCE] Erro ao consultar última mensagem:", checkErr.message);
                }
              }

              // e) Verifica se durante a espera um operador humano assumiu o chat ou a IA foi desligada
              try {
                const { data: recheckedConv } = await supabaseAdmin
                  .from('chat_conversations')
                  .select('is_bot_active, is_human_controlled, assigned_user_id, kanban_stage, stage, status')
                  .eq('id', conversation.id)
                  .maybeSingle();

                if (recheckedConv && isConversationHumanOrPaused(recheckedConv, isWeblojaOrder)) {
                  console.log(`[WEBHOOK DEBOUNCE] 👤 Conversa ${conversation.id} já está em atendimento humano após espera. Abortando IA.`);
                  return res.status(200).json({ handled: 'human_takeover_during_debounce' });
                }
              } catch (convCheckErr: any) {
                console.warn("[WEBHOOK DEBOUNCE] Erro ao re-verificar conversa:", convCheckErr.message);
              }

              // f) Consolidação de mensagens do cliente enviadas nos últimos 60 segundos
              let consolidatedText = effectiveText || text;
              try {
                const { data: lastStaffMsg } = await supabaseAdmin
                  .from('chat_messages')
                  .select('created_at')
                  .eq('conversation_id', conversation.id)
                  .in('sender_type', ['BOT', 'USER', 'SYSTEM'])
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();

                const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
                const cutoffTime = (lastStaffMsg?.created_at && lastStaffMsg.created_at > sixtySecondsAgo)
                  ? lastStaffMsg.created_at
                  : sixtySecondsAgo;

                const { data: pendingCustomerMsgs } = await supabaseAdmin
                  .from('chat_messages')
                  .select('id, content, created_at')
                  .eq('conversation_id', conversation.id)
                  .in('sender_type', ['CUSTOMER', 'CLIENT'])
                  .gte('created_at', cutoffTime)
                  .order('created_at', { ascending: true });

                if (pendingCustomerMsgs && pendingCustomerMsgs.length > 0) {
                  const texts = pendingCustomerMsgs
                    .map(m => {
                      let raw = (m.content || '').trim();
                      if (raw.startsWith('🎤') || raw.toLowerCase().includes('[áudio]') || raw.toLowerCase().includes('[audio]')) {
                        raw = raw
                          .replace(/^🎤\s*\[Áudio\]:?\s*"?/i, '')
                          .replace(/^🎤\s*\[Audio\]:?\s*"?/i, '')
                          .replace(/"?\s*$/, '')
                          .replace(/^\[Áudio\]:?\s*/i, '')
                          .replace(/^\[Audio\]:?\s*/i, '')
                          .trim();
                      }
                      return raw;
                    })
                    .filter(t => t.length > 0 && !t.startsWith('[') && !t.endsWith(']'));
                  
                  if (texts.length > 0) {
                    consolidatedText = texts.join('\n');
                  }
                }

                if (!consolidatedText || (consolidatedText.startsWith('[') && consolidatedText.endsWith(']'))) {
                  if (effectiveText && !effectiveText.startsWith('[')) {
                    consolidatedText = effectiveText;
                  }
                }

                if (isAudioMessage && (!consolidatedText || consolidatedText.startsWith('[') || consolidatedText.trim().length === 0)) {
                  console.warn(`[WEBHOOK DEBOUNCE] ⚠️ Mensagem de áudio consolidada vazia para conversa ${conversation.id}. Acionando helper blindado de fallback.`);
                  const fbRes = await sendAudioFallbackIfAiExplicitlyEnabled({
                    tenantId: storeId,
                    tenant: resolvedTenant,
                    conversation,
                    instanceName,
                    cleanPhone,
                    isWeblojaOrder,
                    persistInChat: false
                  });
                  return res.status(200).json({
                    success: true,
                    handled: fbRes.sent ? 'audio_empty_friendly_replied' : 'audio_empty_silenced'
                  });
                }
              } catch (consolErr: any) {
                console.warn("[WEBHOOK DEBOUNCE] Erro ao consolidar histórico recente:", consolErr.message);
              }

              console.log(`[WEBHOOK DEBOUNCE] 💬 Mensagem unificada para envio à IA na conversa ${conversation.id} (replyWithAudio: ${isAudioMessage}):\n"${consolidatedText}"`);

              // g) Disparo Único da Mensagem de Boas-Vindas (se elegível hoje e NÃO for pedido de balconista)
              let welcomeSent = false;
              if (tenantAutomation.welcomeEnabled && !detectHumanHandoffIntent(consolidatedText).isHumanRequested) {
                try {
                  welcomeSent = await handleDailyWelcomeMessage(storeId, conversation, instanceName, consolidatedText);
                } catch (welcomeErr: any) {
                  console.error('[WEBHOOK] Exceção ao processar boas-vindas diárias:', welcomeErr.message);
                }
              }

              if (welcomeSent) {
                console.log(`[WEBHOOK] Mensagem de boas-vindas enviada com sucesso para a conversa ${conversation.id}. Interrompendo fluxo para evitar resposta duplicada do Agente de IA.`);
                return res.status(200).json({ success: true, handled: 'welcome_message' });
              }

              // h) Mantém presença ativa ("composing" para resposta 100% em texto)
              if (instanceName && cleanPhone) {
                evolutionApiService.sendPresence(instanceName, cleanPhone, "composing", 3500).catch(() => {});
              }

              // i) Disparo ÚNICO para o Agente de IA com o texto consolidado (resposta 100% em TEXTO)
              try {
                console.log(`[WEBHOOK - IA] 🤖 Despachando turno único consolidado para AiAgentService na conversa ${conversation.id} (${cleanPhone}, resposta 100% TEXTO)...`);
                const aiResult = await aiAgentService.processConversationTurn(storeId, conversation.id, consolidatedText, {
                  instanceName,
                  phoneNumber: cleanPhone,
                  replyWithAudio: false
                });

                return res.status(200).json({
                  success: true,
                  handled: 'ai_processed',
                  consolidatedText,
                  aiResult
                });
              } catch (aiErr: any) {
                console.error('[WEBHOOK - IA ISOLADA] Exceção no processamento do Agente de IA:', aiErr.message);
                return res.status(200).json({ success: false, error: aiErr.message });
              }
            } else {
              // BLINDAGEM ANTI-ECO (mensagens com fromMe === true)
              const msgKeyId = msg.key?.id || msg.id;
              const echoText = String(effectiveText || text || "");
              const isEcho = (msgKeyId && botSentMessageIds.has(msgKeyId)) || isBotSentOrEcho(msgKeyId, echoText, conversation?.id, remoteJid);
              if (isEcho) {
                // Verifica se o eco é da própria mensagem de transferência para humano ou se a conversa já foi transferida para humano!
                const isHandoffEcho = detectAiOutputHandoffIntent(echoText).isHandoffOutput;
                let isAlreadyHumanInDb =
                  isHandoffEcho ||
                  conversation?.is_bot_active === false ||
                  conversation?.is_human_controlled === true ||
                  conversation?.kanban_stage === "em_atendimento" ||
                  conversation?.stage === "em_atendimento" ||
                  conversation?.status === "human" ||
                  conversation?.status === "human_takeover";

                if (!isAlreadyHumanInDb && conversation?.id) {
                  try {
                    const { data: dbConvCheck } = await supabaseAdmin
                      .from("chat_conversations")
                      .select("is_bot_active, is_human_controlled, kanban_stage, stage, status")
                      .eq("id", conversation.id)
                      .maybeSingle();
                    if (
                      dbConvCheck &&
                      (dbConvCheck.is_bot_active === false ||
                        dbConvCheck.is_human_controlled === true ||
                        dbConvCheck.kanban_stage === "em_atendimento" ||
                        dbConvCheck.stage === "em_atendimento" ||
                        dbConvCheck.status === "human" ||
                        dbConvCheck.status === "human_takeover")
                    ) {
                      isAlreadyHumanInDb = true;
                    }
                  } catch (_) {}
                }

                if (isAlreadyHumanInDb) {
                  console.log(`[WEBHOOK BLINDAGEM ANTI-ECO] 🤝 Eco de mensagem de transbordo/humano detectado (${msgKeyId}). Preservando conversa ${conversation?.id} em 'em_atendimento' (is_bot_active: false).`);
                  if (conversation) {
                    conversation.is_bot_active = false;
                    conversation.ai_enabled = false;
                    conversation.is_human_controlled = true;
                    conversation.status = "human";
                    conversation.kanban_stage = "em_atendimento";
                    conversation.stage = "em_atendimento";
                  }
                } else {
                  console.log(`[WEBHOOK BLINDAGEM ANTI-ECO] 🤖 Mensagem fromMe identificada como eco normal do bot (${msgKeyId}). Garantindo que a IA permaneça ATIVA na conversa ${conversation?.id}.`);
                  if (conversation) {
                    conversation.is_bot_active = true;
                    conversation.is_human_controlled = false;
                    conversation.status = "bot";
                    conversation.kanban_stage = "ia_atendendo";
                    conversation.stage = "ia_atendendo";

                    try {
                      await supabaseAdmin
                        .from("chat_conversations")
                        .update({
                          is_bot_active: true,
                          is_human_controlled: false,
                          status: "bot",
                          kanban_stage: "ia_atendendo",
                          stage: "ia_atendendo",
                          updated_at: new Date().toISOString()
                        })
                        .eq("id", conversation.id);
                    } catch (_) {}
                  }
                }
                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'bot_echo_ignored' });
                }
                continue;
              } else {
                console.log(`[WEBHOOK HUMAN TAKEOVER] 👤 Mensagem manual enviada por atendente humano no WhatsApp para ${remoteJid}.`);
                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'human_message_recorded' });
                }
                continue;
              }
            }
          }
        } catch (procErr: any) {
          console.error('[ERRO CRITICO NO BACKGROUND]: Exceção no processamento e salvamento do chatStore:', procErr.message, procErr.stack);
        }
      }
    } else if (eventName === "connection.update" || event === "CONNECTION_UPDATE") {
      console.log(`[Webhook Background] Connection update for ${instanceName}: ${data?.state}`);
      const rawState = data?.state || data?.instance?.state;
      if (rawState === "open") {
        const ownerPhone = data?.owner?.split('@')[0] || data?.instance?.owner?.split('@')[0] || null;
        if (instanceName) {
          try {
            const { data: updatedInst } = await safeUpdateWhatsappInstance(
              "instance_name",
              instanceName,
              {
                status: "CONNECTED",
                ...(ownerPhone ? { phone_number: ownerPhone } : {}),
              },
              true
            );
            if (updatedInst?.id && updatedInst?.store_id) {
              await syncStoreInboxesToConnectedInstance(updatedInst.store_id, updatedInst.id);
            }
          } catch (e) {}
        }
      } else if (rawState === "close" || rawState === "disconnected") {
        if (instanceName) {
          try {
            await supabaseAdmin.from("whatsapp_instances").update({
              status: "DISCONNECTED",
              updated_at: new Date().toISOString()
            }).eq("instance_name", instanceName);
          } catch (e) {}
        }
      }
    } else if (eventName === "qrcode.updated" || event === "QRCODE_UPDATED") {
      console.log(`[Webhook Background] QR Code updated for ${instanceName}`);
      let qrCode = data?.qrcode?.base64 || data?.base64;
      const code = data?.qrcode?.code || data?.code;
      if (!qrCode && code) {
        try {
          qrCode = await QRCode.toDataURL(code, { width: 320, margin: 2, color: { dark: '#064e3b', light: '#ffffff' } });
        } catch (e) {}
      }
      if (instanceName) {
        try {
          await supabaseAdmin.from("whatsapp_instances").update({
            status: "QRCODE",
            updated_at: new Date().toISOString()
          }).eq("instance_name", instanceName);
        } catch (e) {}
      }
    }

    return res.status(200).json({ success: true, message: "Webhook processado ultra-rápido" });
  } catch (error: any) {
    console.error("[ERRO CRITICO NO BACKGROUND]: Erro geral no webhook:", error.message, error.stack);
    if (!res.headersSent) {
      return res.status(200).json({ received: true, error: error.message }); 
    }
  }
});

// --- REALTIME SSE SERVER ENDPOINT ---
app.get("/api/v1/realtime/events", (req, res) => {
  // Desabilitado em ambiente Serverless para evitar Vercel Timeout (60s)
  res.status(400).json({ error: "SSE Realtime desativado em ambiente Serverless. Utilize Supabase Realtime no client." });
});

// Listener do WhatsappHealthManager para retransmitir alterações de status das instâncias para o painel em tempo real
whatsappHealthManager.on("instance_status_changed", (eventData) => {
  realtimeHub.broadcastToStore(eventData.storeId, "instance_status", eventData);
});

// --- CRON JOB DE REMÉDIOS DE USO CONTÍNUO ---
// Dispara todos os dias às 09:00 AM
cron.schedule("0 9 * * *", async () => {
  await continuousUseRefillManager.checkAndTriggerRefillReminders();
});

// Endpoint manual para disparar teste de recompra de uso contínuo
app.post("/api/v1/refill/trigger", async (req, res) => {
  try {
    await continuousUseRefillManager.checkAndTriggerRefillReminders();
    res.json({ success: true, message: "Verificação de recompra executada." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- MÓDULO CSAT ENDPOINTS ---
app.get("/api/v1/csat/metrics", async (req, res) => {
  try {
    const storeId = (req.query.storeId as string) || (req.headers["x-tenant-id"] as string);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório" });

    const metrics = await csatManager.getStoreCsatMetrics(storeId);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/csat/schedule", async (req, res) => {
  try {
    const { orderId, delayMinutes } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId é obrigatório" });

    await csatManager.scheduleCsatSurvey(orderId, delayMinutes || 15);
    res.json({ success: true, message: `Pesquisa CSAT agendada para o pedido ${orderId}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- MÓDULO CONTACT MERGE ENDPOINT ---
app.post("/api/v1/contacts/merge", async (req, res) => {
  try {
    const { targetContactId, sourceContactId } = req.body;
    if (!targetContactId || !sourceContactId) {
      return res.status(400).json({ error: "targetContactId e sourceContactId são obrigatórios." });
    }

    const result = await contactMergeManager.mergeContacts(targetContactId, sourceContactId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// MÓDULO: STATUS AUTOMÁTICO NO WHATSAPP (EVOLUTION API V2) + STORIES
// ============================================================================
const STORY_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_STORY_CAPTION_TEMPLATE =
  "Oferta na {loja}: {produto} por R$ {preco}! Peça com entrega rápida: {link}";
const WHATSAPP_DISCONNECTED_STATUS_ERROR =
  "WhatsApp desconectado. Conecte o QR Code antes de publicar no Status.";
const EVOLUTION_CONNECTION_STATE_TIMEOUT_MS = 15000;
const EVOLUTION_SEND_STATUS_TIMEOUT_MS = 120000;
const STORY_IMAGE_DOWNLOAD_TIMEOUT_MS = 15000;
const STORY_PROCESSING_STALE_MS = 5 * 60 * 1000;
const STORY_IMAGE_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

function isSafeExternalHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^0\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function stripDataImagePrefix(raw?: string | null): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
}

function isLikelyImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46 38), WEBP (52 49 46 46 ... 57 45 42 50)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
  const isWebp =
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50;
  return isJpeg || isPng || isGif || isWebp;
}

async function downloadImageUrlToPureBase64(
  imageUrl: string,
  timeoutMs: number = STORY_IMAGE_DOWNLOAD_TIMEOUT_MS
): Promise<{ ok: boolean; base64?: string; sizeBytes?: number; error?: string; durationMs: number }> {
  const startMs = Date.now();
  const cleanUrl = String(imageUrl || "").trim();
  if (!isSafeExternalHttpsUrl(cleanUrl)) {
    return { ok: false, error: "URL da imagem inválida ou não permitida.", durationMs: Date.now() - startMs };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = cleanUrl;
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (!isSafeExternalHttpsUrl(currentUrl)) {
        clearTimeout(timer);
        return {
          ok: false,
          error: "Redirecionamento da imagem bloqueado por segurança.",
          durationMs: Date.now() - startMs,
        };
      }
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }
    clearTimeout(timer);

    if (!res || res.status !== 200) {
      return {
        ok: false,
        error: `Falha ao baixar imagem do Story (HTTP ${res?.status || 0}).`,
        durationMs: Date.now() - startMs,
      };
    }

    const contentLengthHeader = Number(res.headers.get("content-length") || 0);
    if (contentLengthHeader > STORY_IMAGE_MAX_DOWNLOAD_BYTES) {
      return {
        ok: false,
        error: "A imagem do Story excede o tamanho máximo permitido (10 MB).",
        durationMs: Date.now() - startMs,
      };
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length === 0 || buffer.length > STORY_IMAGE_MAX_DOWNLOAD_BYTES) {
      return {
        ok: false,
        error: "Arquivo de imagem vazio ou acima de 10 MB.",
        durationMs: Date.now() - startMs,
      };
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/") && !isLikelyImageBuffer(buffer)) {
      return {
        ok: false,
        error: `Conteúdo retornado não é uma imagem válida (${contentType || "desconhecido"}).`,
        durationMs: Date.now() - startMs,
      };
    }

    return {
      ok: true,
      base64: buffer.toString("base64"),
      sizeBytes: buffer.length,
      durationMs: Date.now() - startMs,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === "AbortError" || String(err?.message || "").includes("aborted");
    return {
      ok: false,
      error: isTimeout
        ? `Tempo limite esgotado (${timeoutMs / 1000}s) ao baixar imagem do Story.`
        : `Erro ao baixar imagem do Story: ${err?.message || "falha de rede"}`,
      durationMs: Date.now() - startMs,
    };
  }
}

function formatStoryProductNameNatural(rawName: string): string {
  const clean = String(rawName || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Oferta Especial";
  // Se estiver todo em caixa alta (comum vindo de ERP), converte para Title Case natural preservando siglas
  const letters = clean.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  const isAllCaps = letters.length >= 4 && letters === letters.toUpperCase();
  if (!isAllCaps) return clean;
  const acronyms = new Set(["FPS", "UVA", "UVB", "ML", "MG", "MCG", "UI", "KIT", "PH", "VIT", "B12", "D3", "K2", "C", "B", "A", "E"]);
  const lowercasePreps = new Set(["de", "da", "do", "das", "dos", "com", "sem", "para", "por", "em", "e", "ou", "a", "o"]);
  return clean
    .split(" ")
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (acronyms.has(upper)) return upper;
      if (/^\d+(ml|mg|g|kg|mcg|un|cp|caps|cpr)$/i.test(word)) return word.toLowerCase();
      const lower = word.toLowerCase();
      if (idx > 0 && lowercasePreps.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function formatStoryBrl(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  return safe.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildStoryStoreBaseUrl(tenantRow: any): string {
  const customDomain = String(tenantRow?.custom_domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (customDomain && customDomain.includes(".")) {
    return `https://${customDomain}`;
  }
  const slug = String(tenantRow?.slug || tenantRow?.id || "").trim().toLowerCase();
  if (slug && /^[a-z0-9-]+$/.test(slug)) {
    return `https://${slug}.farmaflow.online`;
  }
  return "https://farmaflow.online";
}

async function uploadStoryImageToStorage(
  storeId: string,
  imageDataUrl: string
): Promise<{ publicUrl: string | null; pureBase64: string; mimeType: string }> {
  const match = String(imageDataUrl || "").trim().match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return { publicUrl: null, pureBase64: stripDataImagePrefix(imageDataUrl), mimeType: "image/jpeg" };
  }

  let mimeType = match[1].toLowerCase();
  if (mimeType === "image/jpg") mimeType = "image/jpeg";
  const pureBase64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(pureBase64, "base64");

  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    throw new Error("A imagem do Story excede o limite de 8 MB ou está inválida.");
  }

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const safeStoreId = String(storeId || "store").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "store";
  const storagePath = `stories/${safeStoreId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

  try {
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("product-images")
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (!uploadErr) {
      const { data: pubData } = supabaseAdmin.storage
        .from("product-images")
        .getPublicUrl(storagePath);
      if (pubData?.publicUrl && isSafeExternalHttpsUrl(pubData.publicUrl)) {
        return { publicUrl: pubData.publicUrl, pureBase64, mimeType };
      }
    } else {
      console.warn("[StoryStatus] Aviso ao salvar imagem no Supabase Storage (usará base64 direto):", uploadErr.message);
    }
  } catch (err: any) {
    console.warn("[StoryStatus] Fallback para base64 após aviso no Storage:", err?.message || err);
  }

  return { publicUrl: null, pureBase64, mimeType };
}

async function resolveActiveStoreWhatsAppForStatus(storeId: string): Promise<{
  connected: boolean;
  state: string;
  instanceName: string;
  evoConfig: ResolvedEvolutionConfig;
  error?: string;
}> {
  const cleanRaw = String(storeId || "").trim();
  const rawTenant = cleanRaw.replace(/^store_/, "").replace(/^tenant_/, "");
  const cleanStore = rawTenant.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const targetStoreIds = Array.from(new Set([cleanRaw, rawTenant, cleanStore, cleanStore ? `store_${cleanStore}` : ""].filter(Boolean)));

  let activeInstanceRow: any = null;
  try {
    // Busca a instância ativa da loja usando .limit(1) (nunca .single())
    const { data: connectedRows } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, store_id, instance_name, status, evolution_url, evolution_key")
      .in("store_id", targetStoreIds)
      .in("status", ["connected", "open", "CONNECTED", "OPEN"])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (Array.isArray(connectedRows) && connectedRows.length > 0) {
      activeInstanceRow = connectedRows[0];
    } else {
      const { data: anyRows } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id, store_id, instance_name, status, evolution_url, evolution_key")
        .in("store_id", targetStoreIds)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (Array.isArray(anyRows) && anyRows.length > 0) {
        activeInstanceRow = anyRows[0];
      }
    }
  } catch (dbErr: any) {
    console.warn("[StoryStatus] Aviso ao consultar whatsapp_instances:", dbErr?.message || dbErr);
  }

  const evoConfig = await resolveEvolutionConfig(
    cleanRaw,
    activeInstanceRow?.instance_name ? { instanceName: activeInstanceRow.instance_name } : undefined
  );

  if (!evoConfig.evolutionUrl || !evoConfig.evolutionKey) {
    return {
      connected: false,
      state: "unconfigured",
      instanceName: evoConfig.instanceName,
      evoConfig,
      error: WHATSAPP_DISCONNECTED_STATUS_ERROR,
    };
  }

  // Valida estado real de conexão na Evolution API v2 (state === 'open') — timeout curto (15s)
  const stateRes = await evolutionRequestWithFallback(
    evoConfig,
    `/instance/connectionState/${encodeURIComponent(evoConfig.instanceName)}`,
    { method: "GET" },
    EVOLUTION_CONNECTION_STATE_TIMEOUT_MS,
    !evoConfig.isCustomServer
  );

  const liveState = String(
    stateRes.data?.instance?.state ||
    stateRes.data?.state ||
    stateRes.data?.connectionStatus ||
    ""
  )
    .trim()
    .toLowerCase();

  const isConnected = stateRes.ok && liveState === "open";
  if (!isConnected) {
    return {
      connected: false,
      state: liveState || (stateRes.ok ? "close" : `http_${stateRes.status || 0}`),
      instanceName: evoConfig.instanceName,
      evoConfig,
      error: WHATSAPP_DISCONNECTED_STATUS_ERROR,
    };
  }

  return {
    connected: true,
    state: "open",
    instanceName: evoConfig.instanceName,
    evoConfig,
  };
}

async function sendWhatsAppStatus(params: {
  storeId: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  caption?: string | null;
}): Promise<{
  ok: boolean;
  status: number;
  instanceName: string;
  sendMode?: "base64" | "url";
  payloadKb?: number;
  durationMs?: number;
  response?: any;
  error?: string;
}> {
  const storeId = String(params.storeId || "").trim();
  if (!storeId) {
    return { ok: false, status: 400, instanceName: "", error: "storeId é obrigatório." };
  }

  const conn = await resolveActiveStoreWhatsAppForStatus(storeId);
  if (!conn.connected) {
    return {
      ok: false,
      status: 409,
      instanceName: conn.instanceName,
      error: WHATSAPP_DISCONNECTED_STATUS_ERROR,
    };
  }

  const rawImageUrl = String(params.imageUrl || "").trim();
  const rawImageBase64 = String(params.imageBase64 || "").trim();

  // Unifica o formato entre manual, agendado e automático: prioriza SEMPRE base64 puro (sem prefixo data:image)
  // para evitar que a Evolution API trave tentando baixar a imagem externamente.
  let primaryContent = "";
  let sendMode: "base64" | "url" = "base64";
  let fallbackUrl = "";

  if (rawImageBase64) {
    primaryContent = stripDataImagePrefix(rawImageBase64);
    sendMode = "base64";
    if (rawImageUrl && isSafeExternalHttpsUrl(rawImageUrl)) {
      fallbackUrl = rawImageUrl;
    }
  } else if (rawImageUrl.startsWith("data:image/")) {
    primaryContent = stripDataImagePrefix(rawImageUrl);
    sendMode = "base64";
  } else if (rawImageUrl && isSafeExternalHttpsUrl(rawImageUrl)) {
    const dl = await downloadImageUrlToPureBase64(rawImageUrl, STORY_IMAGE_DOWNLOAD_TIMEOUT_MS);
    if (dl.ok && dl.base64) {
      primaryContent = dl.base64;
      sendMode = "base64";
      fallbackUrl = rawImageUrl;
      console.log(
        `[StoryStatus] Imagem baixada pelo backend em ${dl.durationMs}ms (${((dl.sizeBytes || 0) / 1024).toFixed(1)} KB) e convertida para base64 puro | store=${storeId}`
      );
    } else {
      console.warn(
        `[StoryStatus] Aviso ao baixar imagem para base64 (${dl.durationMs}ms): ${dl.error || "erro desconhecido"} | Usando fallback por URL | store=${storeId}`
      );
      primaryContent = rawImageUrl;
      sendMode = "url";
    }
  }

  if (!primaryContent) {
    return {
      ok: false,
      status: 400,
      instanceName: conn.instanceName,
      error: "Informe uma URL HTTPS pública válida ou imagem base64 para publicar no Status.",
    };
  }

  const cleanCaption = String(params.caption || "").trim().slice(0, 700);
  const endpoint = `/message/sendStatus/${encodeURIComponent(conn.instanceName)}`;

  // 1ª tentativa: payload padrão Evolution API v2 com timeout dedicado de 120s (120000ms)
  const standardPayload = {
    type: "image",
    content: primaryContent,
    caption: cleanCaption,
    allContacts: true,
  };
  let payloadJson = JSON.stringify(standardPayload);
  let payloadKb = Number((Buffer.byteLength(payloadJson, "utf8") / 1024).toFixed(1));
  let activeMode: "base64" | "url" = sendMode;

  const evoStartMs = Date.now();
  let evoRes = await evolutionRequestWithFallback(
    conn.evoConfig,
    endpoint,
    {
      method: "POST",
      body: payloadJson,
    },
    EVOLUTION_SEND_STATUS_TIMEOUT_MS,
    !conn.evoConfig.isCustomServer
  );

  // 2ª tentativa (apenas em 400/422): formato alternativo wrapper statusMessage usado por algumas builds da Evolution v2
  if (!evoRes.ok && (evoRes.status === 400 || evoRes.status === 422)) {
    const wrappedPayload = {
      statusMessage: {
        type: "image",
        content: primaryContent,
        caption: cleanCaption,
        allContacts: true,
      },
    };
    const wrappedJson = JSON.stringify(wrappedPayload);
    const retryWrapped = await evolutionRequestWithFallback(
      conn.evoConfig,
      endpoint,
      {
        method: "POST",
        body: wrappedJson,
      },
      EVOLUTION_SEND_STATUS_TIMEOUT_MS,
      !conn.evoConfig.isCustomServer
    );
    if (retryWrapped.ok) {
      evoRes = retryWrapped;
      payloadJson = wrappedJson;
      payloadKb = Number((Buffer.byteLength(payloadJson, "utf8") / 1024).toFixed(1));
    }
  }

  // 3ª tentativa (apenas se erro 400/422 em base64 e temos URL HTTPS pública válida de fallback)
  if (!evoRes.ok && (evoRes.status === 400 || evoRes.status === 422) && activeMode === "base64" && fallbackUrl) {
    const urlPayloadJson = JSON.stringify({
      type: "image",
      content: fallbackUrl,
      caption: cleanCaption,
      allContacts: true,
    });
    const retryUrl = await evolutionRequestWithFallback(
      conn.evoConfig,
      endpoint,
      {
        method: "POST",
        body: urlPayloadJson,
      },
      EVOLUTION_SEND_STATUS_TIMEOUT_MS,
      !conn.evoConfig.isCustomServer
    );
    if (retryUrl.ok) {
      evoRes = retryUrl;
      activeMode = "url";
      payloadJson = urlPayloadJson;
      payloadKb = Number((Buffer.byteLength(payloadJson, "utf8") / 1024).toFixed(1));
    }
  }

  const durationMs = Date.now() - evoStartMs;

  if (evoRes.ok) {
    console.log(
      `[StoryStatus] Status publicado no WhatsApp com sucesso | store=${storeId} | instance=${conn.instanceName} | modo=${activeMode} | payload=${payloadKb} KB | tempo=${durationMs}ms | HTTP ${evoRes.status}`
    );
    return {
      ok: true,
      status: evoRes.status || 200,
      instanceName: conn.instanceName,
      sendMode: activeMode,
      payloadKb,
      durationMs,
      response: evoRes.data ?? evoRes.rawText ?? { ok: true },
    };
  }

  const errorDetail =
    formatEvolutionErrorDetail(evoRes) ||
    `Falha ao publicar Status na Evolution API (HTTP ${evoRes.status || 500}).`;

  console.error(
    `[StoryStatus] Falha ao publicar Status no WhatsApp | store=${storeId} | instance=${conn.instanceName} | modo=${activeMode} | payload=${payloadKb} KB | tempo=${durationMs}ms | HTTP ${evoRes.status}:`,
    errorDetail
  );

  return {
    ok: false,
    status: evoRes.status || 500,
    instanceName: conn.instanceName,
    sendMode: activeMode,
    payloadKb,
    durationMs,
    response: evoRes.data ?? evoRes.rawText ?? null,
    error: errorDetail,
  };
}

function normalizeStoryAutomationSettingsInput(storeId: string, body: any) {
  const enabled = Boolean(body?.enabled);

  const rawTimes = Array.isArray(body?.post_times) ? body.post_times : ["09:00", "14:00", "18:00"];
  const validTimes = Array.from(
    new Set(
      rawTimes
        .map((t: any) => String(t || "").trim())
        .filter((t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    )
  )
    .sort()
    .slice(0, 10);

  const rawDays = Array.isArray(body?.days_of_week) ? body.days_of_week : [1, 2, 3, 4, 5, 6];
  const validDays = Array.from(
    new Set(
      rawDays
        .map((d: any) => Number(d))
        .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
    )
  ).sort((a: number, b: number) => a - b);

  const maxPostsRaw = Number(body?.max_posts_per_day);
  const maxPostsPerDay = Number.isFinite(maxPostsRaw)
    ? Math.max(1, Math.min(10, Math.round(maxPostsRaw)))
    : 3;

  const captionTemplate = String(body?.caption_template ?? DEFAULT_STORY_CAPTION_TEMPLATE)
    .trim()
    .slice(0, 500) || DEFAULT_STORY_CAPTION_TEMPLATE;

  return {
    store_id: storeId,
    enabled,
    post_times: validTimes.length > 0 ? validTimes : ["09:00", "14:00", "18:00"],
    days_of_week: validDays.length > 0 ? validDays : [1, 2, 3, 4, 5, 6],
    max_posts_per_day: maxPostsPerDay,
    caption_template: captionTemplate,
    updated_at: new Date().toISOString(),
  };
}

function renderAutomatedStoryCaption(
  template: string,
  ctx: {
    storeName: string;
    productName: string;
    finalPrice: number;
    originalPrice: number;
    discountPercent: number;
    offerUrl: string;
  }
): string {
  const base = String(template || DEFAULT_STORY_CAPTION_TEMPLATE).trim() || DEFAULT_STORY_CAPTION_TEMPLATE;
  const discountLabel = ctx.discountPercent > 0 ? `${ctx.discountPercent}% OFF` : "";
  return base
    .replace(/\{loja\}/gi, ctx.storeName)
    .replace(/\{produto\}/gi, ctx.productName)
    .replace(/\{nome\}/gi, ctx.productName)
    .replace(/\{preco\}/gi, formatStoryBrl(ctx.finalPrice))
    .replace(/\{preco_antigo\}/gi, formatStoryBrl(ctx.originalPrice))
    .replace(/\{desconto\}/gi, discountLabel)
    .replace(/\{link\}/gi, ctx.offerUrl)
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 700);
}

async function runAutomatedStoryPostForStore(
  storeId: string,
  setting?: any,
  sourceLabel: string = "automation"
): Promise<{ success: boolean; post?: any; error?: string }> {
  // 1. Busca dados da loja (.limit(1))
  const { data: tenantRows } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug, custom_domain, whatsapp")
    .eq("id", storeId)
    .limit(1);

  const tenantRow = Array.isArray(tenantRows) && tenantRows.length > 0 ? tenantRows[0] : null;
  const storeName = String(tenantRow?.name || "Nossa Farmácia").trim();

  // 2. Busca produtos elegíveis com foto pública HTTPS e estoque > 0
  const { data: productRows, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price, promotional_price, original_price, stock, image, is_featured, internal_code, barcode")
    .eq("tenant_id", storeId)
    .gt("stock", 0)
    .gt("price", 0)
    .not("image", "is", null)
    .limit(200);

  if (prodErr) {
    return { success: false, error: `Erro ao buscar produtos da loja: ${prodErr.message}` };
  }

  const eligibleProducts = (productRows || []).filter((p: any) => {
    const img = String(p?.image || "").trim();
    if (!img || img === "IGNORE" || img === "PENDENTE_CURADORIA" || img.includes("fLz8F3X.png")) return false;
    return isSafeExternalHttpsUrl(img);
  });

  if (eligibleProducts.length === 0) {
    const errMsg = "Nenhum produto elegível com estoque e foto pública HTTPS encontrado para automação de Status.";
    const { data: failedRows } = await supabaseAdmin
      .from("story_posts")
      .insert([{
        store_id: storeId,
        product_id: null,
        caption: "",
        image_url: null,
        status: "failed",
        channel: "whatsapp_status",
        source: sourceLabel,
        scheduled_for: new Date().toISOString(),
        sent_at: null,
        error_message: errMsg,
        evolution_response: null,
      }])
      .select("*")
      .limit(1);
    return { success: false, post: failedRows?.[0] || null, error: errMsg };
  }

  // 3. Evita repetir produtos publicados nos últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPosts } = await supabaseAdmin
    .from("story_posts")
    .select("product_id")
    .eq("store_id", storeId)
    .eq("status", "sent")
    .gte("created_at", sevenDaysAgo)
    .limit(100);

  const recentProductIds = new Set(
    (recentPosts || []).map((r: any) => String(r?.product_id || "")).filter(Boolean)
  );

  const scoreProduct = (p: any) => {
    const sale = Number(p.price) || 0;
    const promo = Number(p.promotional_price) || 0;
    const orig = Math.max(Number(p.original_price) || 0, sale);
    const eff = promo > 0 && promo < sale ? promo : sale;
    const hasDiscount = orig > eff && eff > 0;
    const discountPct = hasDiscount ? Math.round(((orig - eff) / orig) * 100) : 0;
    const notRecent = !recentProductIds.has(String(p.id));
    return (notRecent ? 1000 : 0) + (hasDiscount ? 200 + discountPct : 0) + (p.is_featured ? 80 : 0);
  };

  const ranked = [...eligibleProducts].sort((a, b) => scoreProduct(b) - scoreProduct(a));
  const chosen = ranked[0];

  const salePrice = Number(chosen.price) || 0;
  const promoPrice = Number(chosen.promotional_price) || 0;
  const finalPrice = promoPrice > 0 && promoPrice < salePrice ? promoPrice : salePrice;
  const originalPrice = Math.max(Number(chosen.original_price) || 0, salePrice);
  const discountPercent = originalPrice > finalPrice && finalPrice > 0
    ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100)
    : 0;

  const baseStoreUrl = buildStoryStoreBaseUrl(tenantRow);
  const prodSlug = buildSeoProductSlug(chosen);
  const offerUrl = `${baseStoreUrl}/produto/${encodeURIComponent(prodSlug)}?origem=story`;

  const caption = renderAutomatedStoryCaption(
    setting?.caption_template || DEFAULT_STORY_CAPTION_TEMPLATE,
    {
      storeName,
      productName: formatStoryProductNameNatural(chosen.name),
      finalPrice,
      originalPrice,
      discountPercent,
      offerUrl,
    }
  );

  const startedAtIso = new Date().toISOString();
  // Grava como 'processing' ANTES de acionar a Evolution API para evitar concorrência entre ciclos
  const { data: pendingRows } = await supabaseAdmin
    .from("story_posts")
    .insert([{
      store_id: storeId,
      product_id: chosen.id ? String(chosen.id) : null,
      caption,
      image_url: chosen.image,
      status: "processing",
      channel: "whatsapp_status",
      source: sourceLabel,
      scheduled_for: startedAtIso,
      sent_at: null,
      error_message: null,
      evolution_response: { processing_started_at: startedAtIso },
    }])
    .select("*")
    .limit(1);

  const createdPostId = pendingRows?.[0]?.id || null;

  const sendResult = await sendWhatsAppStatus({
    storeId,
    imageUrl: chosen.image,
    caption,
  });

  const finishedAtIso = new Date().toISOString();
  let savedPost: any = pendingRows?.[0] || null;

  if (createdPostId) {
    const { data: updatedRows } = await supabaseAdmin
      .from("story_posts")
      .update({
        status: sendResult.ok ? "sent" : "failed",
        sent_at: sendResult.ok ? finishedAtIso : null,
        error_message: sendResult.ok ? null : (sendResult.error || "Falha ao enviar Status no WhatsApp."),
        evolution_response: sendResult.response || null,
      })
      .eq("id", createdPostId)
      .select("*")
      .limit(1);
    savedPost = updatedRows?.[0] || savedPost;
  } else {
    const { data: savedRows } = await supabaseAdmin
      .from("story_posts")
      .insert([{
        store_id: storeId,
        product_id: chosen.id ? String(chosen.id) : null,
        caption,
        image_url: chosen.image,
        status: sendResult.ok ? "sent" : "failed",
        channel: "whatsapp_status",
        source: sourceLabel,
        scheduled_for: startedAtIso,
        sent_at: sendResult.ok ? finishedAtIso : null,
        error_message: sendResult.ok ? null : (sendResult.error || "Falha ao enviar Status no WhatsApp."),
        evolution_response: sendResult.response || null,
      }])
      .select("*")
      .limit(1);
    savedPost = savedRows?.[0] || null;
  }

  return {
    success: sendResult.ok,
    post: savedPost,
    error: sendResult.ok ? undefined : sendResult.error,
  };
}

// Controle em memória de ticks do agendador (evita duplicação no mesmo minuto e controla posts em voo)
const inFlightStoryPostIds = new Set<string>();
const firedAutomationSlots = new Set<string>();

function getBrazilNowParts(): { dateStr: string; hhmm: string; dayOfWeek: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = get("hour") === "24" ? "00" : get("hour");
  const hhmm = `${hour}:${get("minute")}`;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[get("weekday")] ?? now.getDay();
  return { dateStr, hhmm, dayOfWeek };
}

async function recoverStaleProcessingStoryPosts() {
  try {
    const { data: processingRows } = await supabaseAdmin
      .from("story_posts")
      .select("id, store_id, scheduled_for, created_at, evolution_response")
      .eq("status", "processing")
      .limit(50);

    if (!Array.isArray(processingRows) || processingRows.length === 0) return;

    const nowMs = Date.now();
    for (const row of processingRows) {
      const startedRaw =
        row?.evolution_response?.processing_started_at ||
        row?.scheduled_for ||
        row?.created_at;
      const startedMs = startedRaw ? new Date(startedRaw).getTime() : 0;
      if (startedMs > 0 && nowMs - startedMs > STORY_PROCESSING_STALE_MS) {
        inFlightStoryPostIds.delete(String(row.id));
        console.warn(
          `[StoryScheduler] Registro ${row.id} (store=${row.store_id}) preso em 'processing' há mais de 5 minutos. Marcando como 'failed'.`
        );
        await supabaseAdmin
          .from("story_posts")
          .update({
            status: "failed",
            error_message:
              "Publicação interrompida: o envio permaneceu em processamento por mais de 5 minutos sem confirmação da Evolution API. Tente reenviar.",
          })
          .eq("id", row.id)
          .eq("status", "processing");
      }
    }
  } catch (err: any) {
    console.warn("[StoryScheduler] Aviso ao verificar registros presos em processing:", err?.message || err);
  }
}

async function processScheduledAndAutomatedStoriesTick() {
  try {
    // 0) Recupera qualquer registro preso em 'processing' há mais de 5 minutos
    await recoverStaleProcessingStoryPosts();

    const nowIso = new Date().toISOString();

    // A) Processa agendamentos individuais na tabela story_posts (status = 'scheduled' e scheduled_for <= agora)
    const { data: duePosts } = await supabaseAdmin
      .from("story_posts")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(10);

    if (Array.isArray(duePosts) && duePosts.length > 0) {
      for (const post of duePosts) {
        const postIdStr = String(post.id);
        if (inFlightStoryPostIds.has(postIdStr)) continue;
        inFlightStoryPostIds.add(postIdStr);

        // Marca como 'processing' no Supabase ANTES de chamar sendWhatsAppStatus (evita reenvio no próximo ciclo de 60s)
        const processingStartedIso = new Date().toISOString();
        const { data: lockedRows } = await supabaseAdmin
          .from("story_posts")
          .update({
            status: "processing",
            error_message: null,
            evolution_response: { processing_started_at: processingStartedIso },
          })
          .eq("id", post.id)
          .eq("status", "scheduled")
          .select("id")
          .limit(1);

        if (!Array.isArray(lockedRows) || lockedRows.length === 0) {
          inFlightStoryPostIds.delete(postIdStr);
          continue;
        }

        // Dispara em paralelo sem bloquear o ciclo de 60s de outras lojas caso a Evolution demore até 120s
        (async () => {
          try {
            const sendResult = await sendWhatsAppStatus({
              storeId: post.store_id,
              imageUrl: post.image_url,
              caption: post.caption,
            });

            await supabaseAdmin
              .from("story_posts")
              .update({
                status: sendResult.ok ? "sent" : "failed",
                sent_at: sendResult.ok ? new Date().toISOString() : null,
                error_message: sendResult.ok ? null : (sendResult.error || "Erro ao publicar Status agendado."),
                evolution_response: sendResult.response || null,
              })
              .eq("id", post.id);
          } catch (postErr: any) {
            console.error(`[StoryScheduler] Erro ao processar post agendado ${post.id}:`, postErr?.message || postErr);
            await supabaseAdmin
              .from("story_posts")
              .update({
                status: "failed",
                error_message: postErr?.message || "Erro inesperado ao publicar Status.",
              })
              .eq("id", post.id);
          } finally {
            inFlightStoryPostIds.delete(postIdStr);
          }
        })();
      }
    }

    // B) Processa automações diárias habilitadas em story_automation_settings
    const { data: activeSettings } = await supabaseAdmin
      .from("story_automation_settings")
      .select("*")
      .eq("enabled", true)
      .limit(100);

    if (Array.isArray(activeSettings) && activeSettings.length > 0) {
      const { dateStr, hhmm, dayOfWeek } = getBrazilNowParts();

      // Limpa chaves antigas de dias anteriores para manter memória enxuta
      if (firedAutomationSlots.size > 500) {
        for (const key of firedAutomationSlots) {
          if (!key.includes(`|${dateStr}|`)) firedAutomationSlots.delete(key);
        }
      }

      for (const setting of activeSettings) {
        try {
          const sId = String(setting.store_id || "").trim();
          if (!sId) continue;

          const days: number[] = Array.isArray(setting.days_of_week)
            ? setting.days_of_week.map((d: any) => Number(d))
            : [];
          if (days.length > 0 && !days.includes(dayOfWeek)) continue;

          const times: string[] = Array.isArray(setting.post_times)
            ? setting.post_times.map((t: any) => String(t).trim())
            : [];
          if (!times.includes(hhmm)) continue;

          const slotKey = `${sId}|${dateStr}|${hhmm}`;
          if (firedAutomationSlots.has(slotKey)) continue;
          firedAutomationSlots.add(slotKey);

          // Respeita limite máximo diário (max_posts_per_day) no fuso de Brasília
          const dayStartIso = `${dateStr}T00:00:00-03:00`;
          const { count: todayCount } = await supabaseAdmin
            .from("story_posts")
            .select("id", { count: "exact", head: true })
            .eq("store_id", sId)
            .eq("source", "automation")
            .in("status", ["sent", "processing"])
            .gte("created_at", dayStartIso);

          const maxPerDay = Math.max(1, Number(setting.max_posts_per_day) || 3);
          if ((todayCount || 0) >= maxPerDay) continue;

          console.log(`[StoryScheduler] Disparando Status automático | store=${sId} | slot=${dateStr} ${hhmm}`);
          runAutomatedStoryPostForStore(sId, setting, "automation").catch((autoErr: any) => {
            console.error(`[StoryScheduler] Erro na automação da loja ${sId}:`, autoErr?.message || autoErr);
          });
        } catch (autoErr: any) {
          console.error(`[StoryScheduler] Erro na automação da loja ${setting?.store_id}:`, autoErr?.message || autoErr);
        }
      }
    }
  } catch (err: any) {
    console.warn("[StoryScheduler] Aviso no ciclo do agendador:", err?.message || err);
  }
}

// Cron leve a cada minuto (zero Puppeteer/Playwright)
cron.schedule("* * * * *", async () => {
  await processScheduledAndAutomatedStoriesTick();
});

// Helper para extrair storeId validado pelo checkTenantAccess nas rotas /api/v1/stories/*
function resolveStoryRouteStoreId(req: express.Request): string {
  return String(
    (req as any).tenant?.id ||
    (req.headers["x-tenant-id"] as string) ||
    (req.query.tenantId as string) ||
    ""
  ).trim();
}

// 1. Verificar estado de conexão do WhatsApp para publicar Status
app.get("/api/v1/stories/whatsapp-status", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const status = await resolveActiveStoreWhatsAppForStatus(storeId);
    return res.json({
      connected: status.connected,
      state: status.state,
      instanceName: status.instanceName,
      message: status.connected
        ? "WhatsApp conectado e pronto para publicar no Status."
        : (status.error || WHATSAPP_DISCONNECTED_STATUS_ERROR),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao verificar conexão do WhatsApp." });
  }
});

// 2. Ler configurações de automação (story_automation_settings)
app.get("/api/v1/stories/settings", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const { data: rows, error } = await supabaseAdmin
      .from("story_automation_settings")
      .select("*")
      .eq("store_id", storeId)
      .limit(1);

    if (error) {
      return res.status(500).json({ error: `Erro ao consultar story_automation_settings: ${error.message}` });
    }

    const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (existing) {
      return res.json({ settings: existing });
    }

    return res.json({
      settings: {
        store_id: storeId,
        enabled: false,
        post_times: ["09:00", "14:00", "18:00"],
        days_of_week: [1, 2, 3, 4, 5, 6],
        max_posts_per_day: 3,
        caption_template: DEFAULT_STORY_CAPTION_TEMPLATE,
        updated_at: null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao carregar configurações de automação." });
  }
});

// 3. Salvar configurações de automação (story_automation_settings)
app.put(["/api/v1/stories/settings", "/api/v1/stories/automation-settings"], checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const payload = normalizeStoryAutomationSettingsInput(storeId, req.body);

    const { data: existingRows } = await supabaseAdmin
      .from("story_automation_settings")
      .select("id")
      .eq("store_id", storeId)
      .limit(1);

    let savedRow: any = null;
    if (Array.isArray(existingRows) && existingRows.length > 0 && existingRows[0]?.id) {
      const { data: updated, error: updErr } = await supabaseAdmin
        .from("story_automation_settings")
        .update(payload)
        .eq("id", existingRows[0].id)
        .eq("store_id", storeId)
        .select("*")
        .limit(1);
      if (updErr) {
        return res.status(500).json({ error: `Erro ao atualizar automação: ${updErr.message}` });
      }
      savedRow = updated?.[0] || payload;
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("story_automation_settings")
        .insert([payload])
        .select("*")
        .limit(1);
      if (insErr) {
        return res.status(500).json({ error: `Erro ao salvar automação: ${insErr.message}` });
      }
      savedRow = inserted?.[0] || payload;
    }

    return res.json({ success: true, settings: savedRow });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao salvar configurações de automação." });
  }
});

// 4. Listar histórico e agendamentos (story_posts)
app.get("/api/v1/stories/posts", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const { data: posts, error } = await supabaseAdmin
      .from("story_posts")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      return res.status(500).json({ error: `Erro ao listar story_posts: ${error.message}` });
    }

    return res.json({ posts: posts || [] });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao carregar histórico de Stories." });
  }
});

// 5. Publicar Story agora no Status do WhatsApp (Evolution API v2)
app.post("/api/v1/stories/publish", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const caption = String(req.body?.caption || "").trim().slice(0, 700);
    const productId = req.body?.productId ? String(req.body.productId).trim() : null;
    const source = String(req.body?.source || "manual").trim().slice(0, 40) || "manual";
    const rawImageDataUrl = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
    const rawImageBase64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
    const rawImageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";

    let persistedImageUrl: string | null = null;
    let fallbackBase64: string | null = null;

    if (rawImageDataUrl.startsWith("data:image/")) {
      const uploaded = await uploadStoryImageToStorage(storeId, rawImageDataUrl);
      persistedImageUrl = uploaded.publicUrl;
      fallbackBase64 = uploaded.pureBase64;
    } else if (rawImageUrl) {
      if (!isSafeExternalHttpsUrl(rawImageUrl)) {
        return res.status(400).json({ error: "A URL da imagem deve ser um endereço HTTPS público válido." });
      }
      persistedImageUrl = rawImageUrl;
    } else if (rawImageBase64) {
      const uploaded = await uploadStoryImageToStorage(
        storeId,
        rawImageBase64.startsWith("data:image/") ? rawImageBase64 : `data:image/jpeg;base64,${rawImageBase64}`
      );
      persistedImageUrl = uploaded.publicUrl;
      fallbackBase64 = uploaded.pureBase64;
    }

    if (!persistedImageUrl && !fallbackBase64) {
      return res.status(400).json({ error: "Envie a imagem do Story (PNG/JPEG) ou uma URL HTTPS pública." });
    }

    const sendResult = await sendWhatsAppStatus({
      storeId,
      imageUrl: persistedImageUrl,
      imageBase64: fallbackBase64,
      caption,
    });

    const nowIso = new Date().toISOString();
    const { data: savedRows } = await supabaseAdmin
      .from("story_posts")
      .insert([{
        store_id: storeId,
        product_id: productId,
        caption,
        image_url: persistedImageUrl,
        status: sendResult.ok ? "sent" : "failed",
        channel: "whatsapp_status",
        source,
        scheduled_for: nowIso,
        sent_at: sendResult.ok ? nowIso : null,
        error_message: sendResult.ok ? null : (sendResult.error || "Erro ao publicar Status no WhatsApp."),
        evolution_response: sendResult.response || null,
      }])
      .select("*")
      .limit(1);

    const savedPost = savedRows?.[0] || null;

    if (!sendResult.ok) {
      return res.status(sendResult.status === 409 ? 409 : 502).json({
        success: false,
        error: sendResult.error || "Não foi possível publicar no Status do WhatsApp.",
        instanceName: sendResult.instanceName,
        post: savedPost,
      });
    }

    return res.json({
      success: true,
      message: "Story publicado no Status do WhatsApp com sucesso!",
      instanceName: sendResult.instanceName,
      post: savedPost,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro interno ao publicar no Status do WhatsApp." });
  }
});

// 6. Agendar Story para publicação automática no Status do WhatsApp
app.post("/api/v1/stories/schedule", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const caption = String(req.body?.caption || "").trim().slice(0, 700);
    const productId = req.body?.productId ? String(req.body.productId).trim() : null;
    const rawScheduledFor = String(req.body?.scheduledFor || req.body?.scheduled_for || "").trim();
    const scheduledDate = new Date(rawScheduledFor);

    if (!rawScheduledFor || Number.isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: "Data e horário de agendamento inválidos." });
    }

    const rawImageDataUrl = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
    const rawImageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";
    let persistedImageUrl: string | null = null;

    if (rawImageDataUrl.startsWith("data:image/")) {
      const uploaded = await uploadStoryImageToStorage(storeId, rawImageDataUrl);
      persistedImageUrl = uploaded.publicUrl;
      if (!persistedImageUrl) {
        return res.status(500).json({
          error: "Não foi possível salvar a imagem no Storage para agendamento. Verifique as permissões do bucket product-images.",
        });
      }
    } else if (rawImageUrl) {
      if (!isSafeExternalHttpsUrl(rawImageUrl)) {
        return res.status(400).json({ error: "A URL da imagem deve ser um endereço HTTPS público válido." });
      }
      persistedImageUrl = rawImageUrl;
    } else {
      return res.status(400).json({ error: "Envie a imagem do Story para agendar." });
    }

    const { data: savedRows, error: insErr } = await supabaseAdmin
      .from("story_posts")
      .insert([{
        store_id: storeId,
        product_id: productId,
        caption,
        image_url: persistedImageUrl,
        status: "scheduled",
        channel: "whatsapp_status",
        source: "scheduled",
        scheduled_for: scheduledDate.toISOString(),
        sent_at: null,
        error_message: null,
        evolution_response: null,
      }])
      .select("*")
      .limit(1);

    if (insErr) {
      return res.status(500).json({ error: `Erro ao agendar Story: ${insErr.message}` });
    }

    return res.json({
      success: true,
      message: "Story agendado com sucesso para o Status do WhatsApp!",
      post: savedRows?.[0] || null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro interno ao agendar Story." });
  }
});

// 7. Registrar compartilhamento via Atalho do Instagram Stories no histórico
app.post("/api/v1/stories/log-instagram", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const caption = String(req.body?.caption || "").trim().slice(0, 700);
    const productId = req.body?.productId ? String(req.body.productId).trim() : null;
    const rawImageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";
    const safeImageUrl = rawImageUrl && isSafeExternalHttpsUrl(rawImageUrl) ? rawImageUrl : null;
    const nowIso = new Date().toISOString();

    const { data: savedRows } = await supabaseAdmin
      .from("story_posts")
      .insert([{
        store_id: storeId,
        product_id: productId,
        caption,
        image_url: safeImageUrl,
        status: "sent",
        channel: "instagram_story",
        source: "manual",
        scheduled_for: nowIso,
        sent_at: nowIso,
        error_message: null,
        evolution_response: null,
      }])
      .select("*")
      .limit(1);

    return res.json({ success: true, post: savedRows?.[0] || null });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao registrar histórico do Instagram Stories." });
  }
});

// 8. Reenviar ou publicar imediatamente um post agendado/com falha
app.post("/api/v1/stories/posts/:id/retry", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    const postId = String(req.params.id || "").trim();
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });
    if (!STORY_UUID_REGEX.test(postId)) {
      return res.status(400).json({ error: "ID da publicação inválido." });
    }

    const { data: rows, error: findErr } = await supabaseAdmin
      .from("story_posts")
      .select("*")
      .eq("id", postId)
      .eq("store_id", storeId)
      .limit(1);

    if (findErr || !Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: "Publicação não encontrada para esta loja." });
    }

    const post = rows[0];
    if (!post.image_url) {
      return res.status(400).json({ error: "Esta publicação não possui imagem salva para reenvio." });
    }
    if (post.status === "processing" || inFlightStoryPostIds.has(postId)) {
      return res.status(409).json({ error: "Esta publicação já está em processamento na Evolution API. Aguarde a conclusão." });
    }

    inFlightStoryPostIds.add(postId);
    const processingStartedIso = new Date().toISOString();
    await supabaseAdmin
      .from("story_posts")
      .update({
        status: "processing",
        error_message: null,
        evolution_response: { processing_started_at: processingStartedIso },
      })
      .eq("id", postId)
      .eq("store_id", storeId);

    let sendResult: Awaited<ReturnType<typeof sendWhatsAppStatus>>;
    try {
      sendResult = await sendWhatsAppStatus({
        storeId,
        imageUrl: post.image_url,
        caption: post.caption,
      });
    } finally {
      inFlightStoryPostIds.delete(postId);
    }

    const nowIso = new Date().toISOString();
    const { data: updatedRows } = await supabaseAdmin
      .from("story_posts")
      .update({
        status: sendResult.ok ? "sent" : "failed",
        sent_at: sendResult.ok ? nowIso : null,
        error_message: sendResult.ok ? null : (sendResult.error || "Erro ao publicar Status no WhatsApp."),
        evolution_response: sendResult.response || null,
      })
      .eq("id", postId)
      .eq("store_id", storeId)
      .select("*")
      .limit(1);

    if (!sendResult.ok) {
      return res.status(sendResult.status === 409 ? 409 : 502).json({
        success: false,
        error: sendResult.error,
        post: updatedRows?.[0] || post,
      });
    }

    return res.json({
      success: true,
      message: "Status publicado com sucesso no WhatsApp!",
      post: updatedRows?.[0] || post,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao reenviar Status." });
  }
});

// 9. Excluir ou cancelar publicação agendada/histórico
app.delete("/api/v1/stories/posts/:id", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    const postId = String(req.params.id || "").trim();
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });
    if (!STORY_UUID_REGEX.test(postId)) {
      return res.status(400).json({ error: "ID da publicação inválido." });
    }

    const { error: delErr } = await supabaseAdmin
      .from("story_posts")
      .delete()
      .eq("id", postId)
      .eq("store_id", storeId);

    if (delErr) {
      return res.status(500).json({ error: `Erro ao excluir publicação: ${delErr.message}` });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao excluir publicação." });
  }
});

// 10. Disparar 1 oferta automática imediatamente (teste da automação)
app.post("/api/v1/stories/automation/run-now", checkTenantAccess, async (req, res) => {
  try {
    const storeId = resolveStoryRouteStoreId(req);
    if (!storeId) return res.status(400).json({ error: "storeId é obrigatório." });

    const { data: settingsRows } = await supabaseAdmin
      .from("story_automation_settings")
      .select("*")
      .eq("store_id", storeId)
      .limit(1);

    const setting = Array.isArray(settingsRows) && settingsRows.length > 0 ? settingsRows[0] : null;
    const result = await runAutomatedStoryPostForStore(storeId, setting, "automation_manual_test");

    if (!result.success) {
      return res.status(result.error === WHATSAPP_DISCONNECTED_STATUS_ERROR ? 409 : 400).json({
        success: false,
        error: result.error || "Não foi possível publicar oferta automática.",
        post: result.post || null,
      });
    }

    return res.json({
      success: true,
      message: "Oferta automática publicada no Status do WhatsApp!",
      post: result.post || null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erro ao executar automação de Status." });
  }
});

// --- ENDPOINTS DE CHAT ---
app.get("/api/v1/chat/conversations", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.query.storeId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const inboxId = req.query.inboxId as string | undefined;
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || undefined;
    const userRole = (req.query.role as string) || (req.headers["x-user-role"] as string) || undefined;
    const authHeader = req.headers["authorization"] as string | undefined;

    const opCtx = await resolveOperatorAccessContext(
      storeId,
      userId,
      userRole,
      authHeader,
      req.headers["x-user-id"] as string,
      req.headers["x-user-role"] as string
    );

    if (opCtx.isOperator) {
      const hasAnyScope =
        opCtx.allowedInboxIds.length > 0 ||
        opCtx.allowedTeamIds.length > 0 ||
        opCtx.allowedDepartmentNames.length > 0 ||
        opCtx.operatorIdentifiers.length > 0;

      if (!hasAnyScope) {
        return res.json({ data: [] });
      }

      // Se filtrou por uma caixa específica, valida se o operador tem acesso
      if (inboxId && inboxId !== "all" && inboxId !== "none") {
        if (opCtx.allowedInboxIds.length > 0 && !opCtx.allowedInboxIds.includes(inboxId)) {
          return res.json({ data: [] });
        }
      }
    }

    let selectedInboxName: string | undefined = undefined;
    if (inboxId && inboxId !== "all" && inboxId !== "none" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inboxId.trim())) {
      try {
        const { data: ibRow } = await supabaseAdmin
          .from("inboxes")
          .select("name")
          .eq("id", inboxId.trim())
          .maybeSingle();
        if (ibRow?.name) selectedInboxName = String(ibRow.name).trim();
      } catch (_) {}
    }

    const conversations = await chatStore.getConversations(
      storeId,
      inboxId && inboxId !== "all" && inboxId !== "none" ? inboxId : undefined,
      opCtx.isOperator ? opCtx.allowedInboxIds : undefined,
      {
        allowedTeamIds: opCtx.allowedTeamIds,
        allowedDepartmentNames: opCtx.allowedDepartmentNames,
        operatorIdentifiers: opCtx.operatorIdentifiers,
        selectedInboxName
      }
    );

    return res.json({ data: conversations });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/chat/messages", async (req, res) => {
  try {
    const conversationId = req.query.conversationId as string;
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId é obrigatório" });
    }

    const storeId = (req.query.tenantId as string) || (req.query.storeId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || undefined;
    const userRole = (req.query.role as string) || (req.headers["x-user-role"] as string) || undefined;
    const authHeader = req.headers["authorization"] as string | undefined;

    const accessCheck = await verifyOperatorConversationAccess({
      storeId,
      conversationId,
      userId,
      userRole,
      authHeader,
      headerUserId: req.headers["x-user-id"] as string,
      headerUserRole: req.headers["x-user-role"] as string,
      deniedErrorMessage: "Permissão negada para acessar mensagens desta conversa."
    });

    if (!accessCheck.allowed) {
      return res.status(accessCheck.status || 403).json({ error: accessCheck.error });
    }

    const messages = await chatStore.getMessages(conversationId);
    return res.json({ data: messages });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Envio e persistência de mensagem pelo Balconista/Atendente
app.post("/api/v1/chat/send", requireChatEnabled, async (req, res) => {
  try {
    const {
      conversation_id,
      content,
      is_private,
      media_url,
      mediaUrl,
      media_type,
      type,
      sender_type,
      userId,
      role
    } = req.body;
    const storeId = (req.headers["x-tenant-id"] as string) || (req.body.storeId as string) || (req.body.tenantId as string) || "default";
    const resolvedMediaUrl = media_url || mediaUrl || undefined;
    const resolvedMediaType = media_type || type || undefined;

    if (!conversation_id || (!content && !resolvedMediaUrl)) {
      return res.status(400).json({ success: false, error: "conversation_id e conteúdo são obrigatórios." });
    }

    const accessCheck = await verifyOperatorConversationAccess({
      storeId,
      conversationId: conversation_id,
      userId: userId || (req.headers["x-user-id"] as string) || undefined,
      userRole: role || (req.headers["x-user-role"] as string) || undefined,
      authHeader: req.headers["authorization"] as string | undefined,
      headerUserId: req.headers["x-user-id"] as string | undefined,
      headerUserRole: req.headers["x-user-role"] as string | undefined,
      deniedErrorMessage: "Permissão negada para enviar mensagens nesta conversa."
    });

    if (!accessCheck.allowed) {
      return res.status(accessCheck.status || 403).json({
        success: false,
        error: accessCheck.error || "Permissão negada para enviar mensagens nesta conversa."
      });
    }

    // Resolução blindada da instância CONNECTED para mensagens enviadas ao cliente:
    // 1) inbox.whatsapp_instance_id (status = 'CONNECTED')
    // 2) fallback automático: store_id (status = 'CONNECTED' ORDER BY updated_at DESC LIMIT 1)
    // 3) NUNCA inventar instance_name inexistente (como inbox_<uuid>)
    let resolvedInstance: string | undefined = undefined;
    if (!is_private) {
      const connectedInst = await evolutionApiService.resolveConnectedInstanceForSending({
        storeId,
        conversationId: conversation_id,
      });

      if (!connectedInst) {
        return res.status(422).json({
          success: false,
          error: "Nenhuma instância do WhatsApp conectada foi encontrada para esta loja/caixa de entrada. Conecte o WhatsApp via QR Code antes de enviar mensagens."
        });
      }

      resolvedInstance = connectedInst.instance_name;
      console.log(
        `[Chat API] Instância resolvida "${resolvedInstance}" (origem: ${connectedInst.source}) para conversa ${conversation_id}`
      );
    }

    // Persistir mensagem e despachar via Evolution API com validação síncrona de entrega (strictDelivery)
    const senderUserId = userId || (req.headers["x-user-id"] as string) || undefined;
    const { message, conversation } = await chatStore.addMessage(
      storeId,
      conversation_id,
      sender_type || "USER",
      content || "",
      Boolean(is_private),
      resolvedMediaUrl,
      resolvedMediaType,
      resolvedInstance,
      false,
      senderUserId,
      { strictDelivery: !is_private }
    );

    // Transmitir via SSE
    realtimeHub.broadcastToStore(storeId, "chat_message", {
      conversationId: conversation_id,
      message,
      conversation
    });

    if (is_private) {
      console.log(`[Chat API] Nota interna salva para conversa ${conversation_id}.`);
      return res.status(200).json({ success: true, data: message, is_private: true });
    }

    console.log(`[Chat API] Mensagem de chat salva e entregue para conversa ${conversation_id}: ${content}`);
    return res.status(200).json({ success: true, data: message, conversation });
  } catch (error: any) {
    console.error("[Chat API] Erro ao enviar mensagem:", error);
    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      error: error?.message || "Erro interno ao enviar mensagem pelo WhatsApp."
    });
  }
});

// Endpoint para reagir a uma mensagem (ou remover reação) no chat
app.post("/api/v1/chat/react", requireChatEnabled, async (req, res) => {
  try {
    const { conversation_id, conversationId, message_id, messageId, emoji, instanceName } = req.body;
    const rawStoreId = (req.headers["x-tenant-id"] as string) || (req.query.tenantId as string) || "default";
    const storeId = typeof rawStoreId === 'string' ? rawStoreId.trim().replace(/^store_/, '') : rawStoreId;

    const targetConvId = conversation_id || conversationId;
    const targetMsgId = message_id || messageId;

    if (!targetConvId || !targetMsgId) {
      return res.status(400).json({ error: "conversation_id e message_id são obrigatórios." });
    }

    const result = await chatStore.addOrUpdateReaction(
      storeId,
      targetConvId,
      targetMsgId,
      typeof emoji === "string" ? emoji : "",
      true,
      instanceName
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error || "Falha ao aplicar reação." });
    }

    return res.status(200).json({ success: true, message: result.message });
  } catch (error: any) {
    console.error("[Chat API] Erro ao reagir mensagem:", error);
    return res.status(500).json({ error: error.message || "Erro interno." });
  }
});

// --- PATIENT CONTEXT & CONTINUOUS USE FORECASTING ENDPOINT ---
app.get("/api/v1/chat/patient-context", async (req, res) => {
  try {
    const rawStoreId = (req.query.storeId as string) || (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const storeId = typeof rawStoreId === 'string' ? rawStoreId.trim().replace(/^store_/, '') : rawStoreId;
    const rawPhone = (req.query.phone as string) || "";
    const cleanPhone = String(rawPhone).replace(/\D/g, "");

    if (!cleanPhone) {
      return res.json({ success: true, contact: null, continuousUse: null, orders: [] });
    }

    // 1. Fetch Contact & Custom Attributes (uso_continuo, etc.)
    let contactData: any = null;
    try {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("*")
        .eq("store_id", storeId)
        .like("phone", `%${cleanPhone}%`)
        .maybeSingle();
      contactData = data;
    } catch (e) {}

    // 2. Fetch Orders for this Customer
    const { data: ordersData, error: ordersErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("tenant_id", storeId)
      .order("created_at", { ascending: false })
      .limit(50);

    let matchedOrders: any[] = [];
    if (!ordersErr && Array.isArray(ordersData)) {
      matchedOrders = ordersData.filter((o: any) => {
        if (!o.customer || !o.customer.phone) return false;
        const oPhone = String(o.customer.phone).replace(/\D/g, "");
        return oPhone === cleanPhone || oPhone.includes(cleanPhone) || cleanPhone.includes(oPhone);
      }).slice(0, 10);
    }

    // 3. For each order, fetch items and enrich with order_items / products details
    const enrichedOrders = await Promise.all(matchedOrders.map(async (order: any) => {
      let items = Array.isArray(order.items) ? [...order.items] : [];

      // Try relational order_items table as enrichment if available
      try {
        const { data: orderItemsRel } = await supabaseAdmin
          .from("order_items")
          .select("*, products(*)")
          .eq("order_id", order.id);

        if (orderItemsRel && orderItemsRel.length > 0) {
          items = orderItemsRel.map((oi: any) => ({
            id: oi.product_id || oi.id,
            name: oi.product_name || oi.products?.name || "Produto",
            quantity: oi.quantity || 1,
            price: oi.unit_price || oi.products?.price || 0,
            category: oi.products?.category || "",
            presentation: oi.products?.presentation || "",
            activePrinciple: oi.products?.active_principle || "",
            is_continuous_use: oi.products?.is_continuous_use,
            continuous_use_days: oi.products?.continuous_use_days,
            requires_prescription: oi.products?.requires_prescription
          }));
        }
      } catch (oiErr) {
        // Fallback to order.items jsonb
      }

      // Enrich items with products table details if needed
      const enrichedItems = await Promise.all(items.map(async (item: any) => {
        let isContinuous = item.is_continuous_use;
        let durationDays = item.continuous_use_days;
        let presentation = item.presentation;

        if (item.id) {
          try {
            const { data: prod } = await supabaseAdmin
              .from("products")
              .select("is_continuous_use, continuous_use_days, presentation, category, active_principle")
              .eq("id", item.id)
              .maybeSingle();

            if (prod) {
              if (prod.is_continuous_use !== undefined && isContinuous === undefined) {
                isContinuous = prod.is_continuous_use;
              }
              if (prod.continuous_use_days && !durationDays) {
                durationDays = prod.continuous_use_days;
              }
              if (prod.presentation && !presentation) {
                presentation = prod.presentation;
              }
              if (prod.category && !item.category) item.category = prod.category;
              if (prod.active_principle && !item.activePrinciple) item.activePrinciple = prod.active_principle;
            }
          } catch (e) {}
        }

        return {
          ...item,
          is_continuous_use: isContinuous,
          continuous_use_days: durationDays,
          presentation: presentation || item.presentation
        };
      }));

      return {
        ...order,
        items: enrichedItems
      };
    }));

    return res.json({
      success: true,
      contact: contactData,
      continuousUse: contactData?.custom_attributes?.uso_continuo ? contactData.custom_attributes : null,
      orders: enrichedOrders
    });
  } catch (err: any) {
    console.error("[PatientContext API] Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- LABELS ENDPOINTS ---
app.get("/api/v1/chat/labels", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const labels = await chatStore.getLabels(storeId);
    return res.json({ data: labels });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/chat/labels", async (req, res) => {
  try {
    const storeId = (req.body.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const { id, name, color } = req.body;
    if (!name || !color) {
      return res.status(400).json({ error: "name e color são obrigatórios" });
    }
    const label = await chatStore.saveLabel({ id, store_id: storeId, name, color });
    return res.json({ data: label });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/chat/labels/:id", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const id = req.params.id;
    await chatStore.deleteLabel(id, storeId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/v1/chat/conversations/:id/labels", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const labels = await chatStore.getConversationLabels(conversationId);
    return res.json({ data: labels });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/chat/conversations/:id/labels", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { labelIds } = req.body;
    if (!Array.isArray(labelIds)) {
      return res.status(400).json({ error: "labelIds deve ser um array" });
    }
    await chatStore.setConversationLabels(conversationId, labelIds);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- CANNED RESPONSES ENDPOINTS ---
app.get("/api/v1/chat/canned-responses", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const responses = await chatStore.getCannedResponses(storeId);
    return res.json({ data: responses });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/chat/canned-responses", async (req, res) => {
  try {
    const storeId = (req.body.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const { id, shortcut, text } = req.body;
    if (!shortcut || !text) {
      return res.status(400).json({ error: "shortcut e text são obrigatórios" });
    }
    const response = await chatStore.saveCannedResponse({ id, store_id: storeId, shortcut, text });
    return res.json({ data: response });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/chat/canned-responses/:id", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const id = req.params.id;
    await chatStore.deleteCannedResponse(id, storeId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// These endpoints will be added to server.ts

app.get(["/api/v1/tenants/:tenantId/promos", "/api/tenants/:tenantId/promos", "/api/v1/promos/:tenantId", "/api/promos/:tenantId"], async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    if (!tenantId || tenantId === "undefined" || tenantId === "null") {
      return res.json([]);
    }
    const networkId = req.query.networkId as string | undefined;
    
    let query = supabaseAdmin.from("promotions").select("*");
    if (networkId && networkId !== "undefined" && networkId !== "null" && networkId !== tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    console.error("[GET promos] Erro ao buscar promoções:", e.message);
    res.status(500).json({ error: e.message, data: [] });
  }
});

app.post("/api/v1/tenants/:tenantId/promos", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    // ensure tenant is matching
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }

    if (!payload.filters_metadata) payload.filters_metadata = {};
    if (payload.show_banner_card !== undefined) payload.filters_metadata.show_banner_card = payload.show_banner_card;
    if (payload.banner_headline !== undefined) payload.filters_metadata.banner_headline = payload.banner_headline;

    let { data, error } = await supabaseAdmin.from("promotions").upsert(payload).select().single();
    if (error && (error.message?.includes("show_banner_card") || error.message?.includes("banner_headline") || error.code === "PGRST204")) {
      const safePayload = { ...payload };
      delete safePayload.show_banner_card;
      delete safePayload.banner_headline;
      const retryResult = await supabaseAdmin.from("promotions").upsert(safePayload).select().single();
      data = retryResult.data;
      error = retryResult.error;
    }
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/promos/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const promoId = req.params.id;

    if (!promoId) {
      return res.status(400).json({ error: "ID da promoção não informado." });
    }

    // First check if promo exists to avoid false successes and verify tenant affiliation
    const { data: existingPromo, error: fetchErr } = await supabaseAdmin
      .from("promotions")
      .select("id, tenant_id")
      .eq("id", promoId)
      .maybeSingle();

    if (fetchErr) {
      console.warn("[DELETE promo] Erro ao verificar existência da promoção:", fetchErr);
    }

    if (!existingPromo) {
      // Already deleted or not found
      return res.json({ success: true, message: "Promoção já excluída ou não encontrada.", id: promoId });
    }

    // Delete promo by id
    const { error: deleteErr } = await supabaseAdmin
      .from("promotions")
      .delete()
      .eq("id", promoId);

    if (deleteErr) {
      console.error("[DELETE promo] Erro ao deletar no Supabase:", deleteErr);
      throw deleteErr;
    }

    console.log(`[DELETE promo] Promoção ${promoId} excluída com sucesso.`);
    res.json({ success: true, id: promoId });
  } catch (e: any) {
    console.error("[DELETE promo] Erro na exclusão:", e);
    res.status(500).json({ error: e.message || "Erro ao excluir promoção" });
  }
});

// Vouchers (Coupons)
app.get(["/api/v1/tenants/:tenantId/vouchers", "/api/tenants/:tenantId/vouchers", "/api/v1/vouchers/:tenantId", "/api/vouchers/:tenantId"], async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    if (!tenantId || tenantId === "undefined" || tenantId === "null") {
      return res.json([]);
    }
    const networkId = req.query.networkId as string | undefined;
    
    let query = supabaseAdmin.from("coupons").select("*");
    if (networkId && networkId !== "undefined" && networkId !== "null" && networkId !== tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);
    } else {
      query = query.eq("tenant_id", tenantId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    console.error("[GET vouchers] Erro ao buscar cupons:", e.message);
    res.status(500).json({ error: e.message, data: [] });
  }
});

app.post("/api/v1/tenants/:tenantId/vouchers", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const payload = req.body;
    if (payload.tenant_id !== tenantId) {
        return res.status(403).json({ error: "Tenant mismatch" });
    }
    const cleanCoupon: any = {
      id: payload.id,
      tenant_id: tenantId,
      code: payload.code,
      discount_type: payload.discount_type,
      discount_value: payload.discount_value,
      target_type: payload.target_type || "ALL",
      target_value: payload.target_value || null,
      specific_product_ids: payload.specific_product_ids || payload.applicable_products || [],
      filters_metadata: payload.filters_metadata || null,
      coupon_scope: payload.coupon_scope || "SPECIFIC_PRODUCT",
      min_purchase_value: payload.min_purchase_value || 0,
      start_date: payload.start_date,
      end_date: payload.end_date,
      is_active: payload.is_active !== false,
      scope: payload.scope || "SINGLE_STORE",
    };
    const { data, error } = await supabaseAdmin.from("coupons").upsert(cleanCoupon).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/tenants/:tenantId/vouchers/:id", checkTenantAccess, async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", req.params.id).eq("tenant_id", tenantId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// MEDICAL PRESCRIPTIONS API
// ==========================================

// Public upload endpoint for customers
app.post("/api/v1/store/:tenantId/prescriptions/upload", upload.single("file"), async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado ou campo de arquivo incorreto." });
    }

    const fileExt = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
    const fileName = `${tenantId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    // Normalize MIME type based on extension and common device headers
    let contentType = req.file.mimetype;
    if (contentType === "image/jpg" || fileExt === "jpg" || fileExt === "jpeg") {
      contentType = "image/jpeg";
    } else if (fileExt === "png") {
      contentType = "image/png";
    } else if (fileExt === "pdf") {
      contentType = "application/pdf";
    } else if (fileExt === "webp") {
      contentType = "image/webp";
    }

    const { data, error } = await supabaseAdmin.storage
      .from("medical-prescriptions")
      .upload(fileName, req.file.buffer, {
        contentType: contentType,
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error details:", error);
      return res.status(500).json({ error: `Erro no Supabase Storage: ${error.message || 'Falha no upload'}` });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("medical-prescriptions")
      .getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Create the pending prescription record
    const { data: recordData, error: dbError } = await supabaseAdmin
      .from("medical_prescriptions")
      .insert([{
        store_id: tenantId,
        customer_id: "00000000-0000-0000-0000-000000000000", // Will be updated or linked via order
        file_url: fileUrl,
        status: "PENDING"
      }])
      .select()
      .single();

    if (dbError) {
      // If the table doesn't exist, we fallback to just returning the URL
      console.warn("Could not insert into medical_prescriptions (maybe table does not exist yet):", dbError);
      return res.json({ success: true, fileUrl, id: null });
    }

    res.json({ success: true, fileUrl, id: recordData ? recordData.id : null });
  } catch (error: any) {
    console.error("Critical error during prescription upload:", error);
    res.status(500).json({ error: `Erro interno no servidor: ${error.message || 'Erro desconhecido'}` });
  }
});

// Attach Order ID to a prescription (called from frontend when finalizing checkout)
app.post("/api/v1/store/:tenantId/prescriptions/link", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { fileUrl, orderId, customerId } = req.body;
    
    const { error } = await supabaseAdmin
      .from("medical_prescriptions")
      .update({ order_id: orderId, customer_id: customerId || "00000000-0000-0000-0000-000000000000" })
      .eq("file_url", fileUrl)
      .eq("store_id", tenantId);
      
    if (error) {
      console.error("Link prescription error:", error);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// Admin: List Prescriptions
app.get("/api/v1/tenants/:tenantId/prescriptions", async (req: any, res) => {
  try {
    const { tenantId } = req.params;
    if (!tenantId || tenantId === "undefined" || tenantId === "null") {
      return res.json({ success: true, data: [] });
    }
    const { status } = req.query;

    let query = supabaseAdmin
      .from("medical_prescriptions")
      .select("*")
      .eq("store_id", tenantId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      // Table may not exist or query error; return empty data gracefully
      return res.json({ success: true, data: [] });
    }
    
    return res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error("Error listing prescriptions:", error);
    return res.json({ success: false, data: [] }); // Graceful fallback
  }
});

// Admin: Update Prescription Status
app.patch("/api/v1/tenants/:tenantId/prescriptions/:id/status", checkTenantAccess, async (req: any, res) => {
  try {
    const { tenantId, id } = req.params;
    const { status, notes } = req.body;

    const { data, error } = await supabaseAdmin
      .from("medical_prescriptions")
      .update({ 
        status, 
        notes, 
        validated_by: req.user?.id, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", id)
      .eq("store_id", tenantId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update prescription status" });
  }
});

// ==========================================
// AI SMART ATTENDANT AGENT API
// ==========================================

// Endpoint do Assistente de IA para Atendentes (Copilot de Redação no Chat)
app.post(["/api/v1/chat/ai-copilot", "/api/v1/ai/copilot"], async (req, res) => {
  try {
    const { tenantId, action, text, customInstruction } = req.body;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }
    if (!action) {
      return res.status(400).json({ error: "action é obrigatório (fix, empathy, summarize, expand, custom)." });
    }

    const result = await aiAgentService.generateCopilotAssistance(
      tenantId,
      action,
      text || "",
      customInstruction
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[AI Copilot Error]:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Erro ao processar auxílio de IA para o atendente." });
  }
});

// Endpoint para testar o agente no playground / simulador de configurações
app.post("/api/v1/ai/agent/test", async (req, res) => {
  try {
    const { tenantId, message, history, configOverride } = req.body;
    if (!tenantId || !message) {
      return res.status(400).json({ error: "tenantId e message são obrigatórios." });
    }

    const result = await aiAgentService.generateReply(
      tenantId,
      message,
      history || [],
      configOverride
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[AI Agent Test Error]:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Erro ao processar mensagem com o Agente de IA." });
  }
});

// Endpoint público/atendimento para responder mensagens de clientes
app.post("/api/v1/ai/agent/chat", async (req, res) => {
  try {
    const { tenantId, message, history } = req.body;
    if (!tenantId || !message) {
      return res.status(400).json({ error: "tenantId e message são obrigatórios." });
    }

    const result = await aiAgentService.generateReply(
      tenantId,
      message,
      history || []
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[AI Agent Chat Error]:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Erro ao processar mensagem com o Agente de IA." });
  }
});

// Endpoint para alternar estado do Bot de IA em uma conversa (Silenciar / Reativar)
app.post("/api/v1/chat/conversations/:id/toggle-bot", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { storeId, isBotActive } = req.body;

    if (!conversationId || !storeId || typeof isBotActive !== 'boolean') {
      return res.status(400).json({ error: "conversationId, storeId e isBotActive são obrigatórios." });
    }

    const success = await botHandoffManager.toggleBotActive(conversationId, storeId, isBotActive);
    return res.json({ success, isBotActive });
  } catch (err: any) {
    console.error("[Toggle Bot Error]:", err);
    return res.status(500).json({ error: err.message || "Erro ao alterar estado do bot." });
  }
});

// Endpoint para acionar transbordo manual para humano
app.post("/api/v1/chat/conversations/:id/trigger-handoff", async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { storeId, reason, message } = req.body;

    if (!conversationId || !storeId) {
      return res.status(400).json({ error: "conversationId e storeId são obrigatórios." });
    }

    const result = await botHandoffManager.triggerHandoff(
      conversationId,
      storeId,
      reason || "MANUAL_OPERATOR_TRIGGER",
      message
    );
    return res.json(result);
  } catch (err: any) {
    console.error("[Trigger Handoff Error]:", err);
    return res.status(500).json({ error: err.message || "Erro ao executar transbordo." });
  }
});

// Endpoint para movimentação de estágio no Kanban (Drag-and-Drop) e Automação de Estágio
const handleStageUpdate = async (req: express.Request, res: express.Response) => {
  try {
    const conversationId = req.params.id || req.body.conversationId || req.body.id;
    const storeId = (req.body?.storeId || req.query?.storeId || req.headers["x-tenant-id"] || "default") as string;
    const { stage, kanban_stage, assignedUserId, manual, is_manual_move } = req.body;
    const targetStageInput = stage || kanban_stage;

    if (!conversationId || !targetStageInput) {
      return res.status(400).json({ error: "conversationId e stage são obrigatórios." });
    }

    const isManual = manual === true || is_manual_move === true || targetStageInput === "novos_triagem";

    const validStages = [
      "novos_triagem", "em_atendimento", "aguardando_pagamento", "saiu_entrega", "finalizado",
      "NEW", "BOT", "WAITING", "STORE_REDIRECT", "HUMAN", "CLOSED",
      "novos_clientes", "ia_atendendo", "atendimento_humano", "enviado_webloja", "aguardando_resposta", "em_separacao", "concluido",
      "triagem", "novos", "delivery"
    ];
    if (!validStages.includes(targetStageInput)) {
      return res.status(400).json({ error: `Estágio inválido: ${targetStageInput}. Válidos: ${validStages.join(", ")}` });
    }

    const updated = await chatStore.updateConversationStage(
      conversationId, 
      storeId, 
      targetStageInput, 
      assignedUserId,
      isManual
    );
    
    // Broadcast em tempo real para todos os atendentes conectados no Kanban
    const finalStage = updated?.kanban_stage || targetStageInput;
    realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
      conversationId,
      stage: finalStage,
      kanban_stage: finalStage,
      status: updated?.status,
      is_bot_active: updated?.is_bot_active,
      is_human_controlled: updated?.is_human_controlled,
      assigned_user_id: updated?.assigned_user_id,
      manual: isManual,
      updated_at: new Date().toISOString()
    });

    return res.json({ success: true, conversation: updated, stage: finalStage });
  } catch (err: any) {
    console.error("[Kanban Stage Update Error]:", err);
    return res.status(500).json({ error: err.message || "Erro ao atualizar estágio do Kanban." });
  }
};

app.all("/api/v1/chat/conversations/:id/stage", handleStageUpdate);
app.all("/api/v1/automation/stage", handleStageUpdate);
app.all("/api/v1/chat/conversations/stage", handleStageUpdate);

const handleTransferConversation = async (req: express.Request, res: express.Response) => {
  try {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const conversationId = req.params.id || req.body.conversationId || req.body.conversation_id;
    const storeId = (req.body.storeId as string) || (req.body.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    let inboxId: string | undefined = req.body.inboxId || req.body.inbox_id || undefined;
    let teamId: string | undefined = req.body.teamId || req.body.team_id || undefined;
    let departmentName: string | undefined = req.body.department || req.body.sector || undefined;
    const userId = req.body.userId || req.body.assignedUserId || req.body.assigned_user_id || req.body.assigned_to || undefined;
    const fromUserId = req.body.fromUserId || (req.headers["x-user-id"] as string) || undefined;
    const reason = req.body.reason || req.body.notes || undefined;

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId é obrigatório para transferência." });
    }

    if (!inboxId && !userId && !departmentName && !teamId) {
      return res.status(400).json({ error: "É necessário informar ao menos um departamento (inboxId/department), time ou atendente (userId) de destino." });
    }

    const candidateStoreIds = storeId && storeId !== "default"
      ? await resolveStoreCandidateIds(storeId)
      : [];
    const candidateStoreSet = new Set(candidateStoreIds.map((s) => s.toLowerCase()));
    if (storeId && storeId !== "default") {
      candidateStoreSet.add(storeId.trim().toLowerCase());
    }

    // Validação de isolamento da conversa (resolvendo tenants.id e tenants.slug)
    if (candidateStoreSet.size > 0 && UUID_REGEX.test(String(conversationId).trim())) {
      try {
        const { data: convRow } = await supabaseAdmin
          .from("chat_conversations")
          .select("id, store_id")
          .eq("id", String(conversationId).trim())
          .maybeSingle();
        if (convRow?.store_id && convRow.store_id !== "default") {
          const convStoreCandidates = await resolveStoreCandidateIds(String(convRow.store_id));
          const sameStore =
            candidateStoreSet.has(String(convRow.store_id).trim().toLowerCase()) ||
            convStoreCandidates.some((s) => candidateStoreSet.has(s.toLowerCase()));
          if (!sameStore) {
            return res.status(403).json({ error: "Acesso negado: esta conversa pertence a outro estabelecimento." });
          }
        }
      } catch (_) {}
    }

    // Carrega caixas de entrada da loja para sincronizar inbox_id <-> department <-> team_id
    let storeInboxes: any[] = [];
    if (candidateStoreIds.length > 0) {
      try {
        const { data: ibRows } = await supabaseAdmin
          .from("inboxes")
          .select("id, store_id, name")
          .in("store_id", candidateStoreIds);
        if (Array.isArray(ibRows)) storeInboxes = ibRows;
      } catch (_) {}
    }

    // Se department foi enviado (ex.: "vendas") sem inboxId, resolve o inbox_id real correspondente (case-insensitive)
    if (!inboxId && departmentName && storeInboxes.length > 0) {
      const targetNorm = normalizeDepartmentText(departmentName);
      const matchedInbox = storeInboxes.find((ib) => normalizeDepartmentText(ib.name) === targetNorm);
      if (matchedInbox?.id) {
        inboxId = matchedInbox.id;
        departmentName = matchedInbox.name;
      }
    }

    // Se teamId foi enviado sem inboxId, tenta localizar caixa vinculada via inbox_teams ou nome do time
    if (!inboxId && teamId && UUID_REGEX.test(teamId)) {
      try {
        const { data: linkRow } = await supabaseAdmin
          .from("inbox_teams")
          .select("inbox_id")
          .eq("team_id", teamId.trim())
          .limit(1)
          .maybeSingle();
        if (linkRow?.inbox_id) {
          inboxId = linkRow.inbox_id;
        } else {
          const { data: teamRow } = await supabaseAdmin
            .from("chat_teams")
            .select("name")
            .eq("id", teamId.trim())
            .maybeSingle();
          if (teamRow?.name) {
            const matchedInbox = storeInboxes.find(
              (ib) => normalizeDepartmentText(ib.name) === normalizeDepartmentText(teamRow.name)
            );
            if (matchedInbox?.id) {
              inboxId = matchedInbox.id;
              departmentName = matchedInbox.name;
            } else if (!departmentName) {
              departmentName = teamRow.name;
            }
          }
        }
      } catch (_) {}
    }

    // Validação de isolamento (resolvendo tenants.id e tenants.slug): valida se a caixa pertence ao estabelecimento
    if (inboxId && UUID_REGEX.test(inboxId.trim())) {
      try {
        const { data: inboxRow } = await supabaseAdmin
          .from("inboxes")
          .select("id, store_id, name")
          .eq("id", inboxId.trim())
          .maybeSingle();

        if (inboxRow) {
          if (inboxRow.store_id && candidateStoreSet.size > 0) {
            const inboxStoreCandidates = await resolveStoreCandidateIds(String(inboxRow.store_id));
            const belongsToStore =
              candidateStoreSet.has(String(inboxRow.store_id).trim().toLowerCase()) ||
              inboxStoreCandidates.some((s) => candidateStoreSet.has(s.toLowerCase()));
            if (!belongsToStore) {
              return res.status(403).json({ error: "O departamento selecionado pertence a outro estabelecimento." });
            }
          }
          if (inboxRow.name && !departmentName) {
            departmentName = String(inboxRow.name).trim();
          }

          // Sincroniza team_id correspondente ao departamento/caixa de destino quando existir vínculo
          if (!teamId) {
            try {
              const { data: linkedTeam } = await supabaseAdmin
                .from("inbox_teams")
                .select("team_id")
                .eq("inbox_id", inboxRow.id)
                .limit(1)
                .maybeSingle();
              if (linkedTeam?.team_id) {
                teamId = linkedTeam.team_id;
              } else if (inboxRow.name && candidateStoreIds.length > 0) {
                const { data: storeTeams } = await supabaseAdmin
                  .from("chat_teams")
                  .select("id, name")
                  .in("store_id", candidateStoreIds);
                if (Array.isArray(storeTeams)) {
                  const matchedTeam = storeTeams.find(
                    (t: any) => normalizeDepartmentText(t.name) === normalizeDepartmentText(inboxRow.name)
                  );
                  if (matchedTeam?.id) teamId = matchedTeam.id;
                }
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // Executa a transferência via Service Role (mantendo inbox_id, team_id, department e kanban_stage sincronizados)
    const result = await chatStore.transferConversation(conversationId, storeId, {
      inboxId,
      teamId,
      department: departmentName,
      userId,
      fromUserId,
      reason
    });

    const updated = result.conversation;

    // Disparar broadcast em tempo real para sincronização instantânea
    realtimeHub.broadcastToStore(storeId, "conversation_transferred", {
      conversationId,
      storeId,
      inboxId: updated?.inbox_id || inboxId,
      teamId: (updated as any)?.team_id || teamId,
      department: (updated as any)?.department || departmentName,
      assignedUserId: updated?.assigned_user_id || userId,
      status: updated?.status,
      kanban_stage: updated?.kanban_stage || (userId ? "em_atendimento" : "novos_triagem"),
      is_human_controlled: updated?.is_human_controlled,
      is_bot_active: updated?.is_bot_active,
      updated_at: updated?.updated_at || new Date().toISOString()
    });

    realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
      conversationId,
      stage: updated?.kanban_stage || (userId ? "em_atendimento" : "novos_triagem"),
      kanban_stage: updated?.kanban_stage || (userId ? "em_atendimento" : "novos_triagem"),
      status: updated?.status,
      is_bot_active: updated?.is_bot_active,
      is_human_controlled: updated?.is_human_controlled,
      assigned_user_id: updated?.assigned_user_id,
      updated_at: updated?.updated_at || new Date().toISOString()
    });

    if (result.message) {
      realtimeHub.broadcastToStore(storeId, "chat_message", {
        conversationId,
        message: result.message,
        conversation: updated
      });
    }

    return res.json({
      success: true,
      message: "Conversa transferida com sucesso.",
      data: updated,
      conversation: updated
    });
  } catch (err: any) {
    console.error("[Chat Transfer Error]:", err);
    return res.status(500).json({ error: err.message || "Erro ao transferir conversa." });
  }
};

app.post("/api/v1/chat/conversations/:id/transfer", handleTransferConversation);
app.post("/api/v1/chat/transfer", handleTransferConversation);

// ==============================================================================
// NOTIFICAÇÕES WEB PUSH PROMOCIONAIS (PWA PUSH NOTIFICATIONS ISOLADAS POR LOJA)
// ==============================================================================

const slugifyStoreIdentifier = (raw: any): string => {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

app.get(
  ["/api/v1/push/vapid-public-key", "/api/push/vapid-public-key"],
  async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const keys = await getOrInitVapidKeys(supabaseAdmin);
      const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
      let subscriberCount = 0;
      if (tenantId) {
        const subs = await getTenantPushSubscriptions(supabaseAdmin, tenantId);
        subscriberCount = subs.length;
      }
      if (!keys) {
        return res.status(200).json({
          publicKey: null,
          configured: false,
          subscriberCount,
        });
      }
      return res.status(200).json({
        publicKey: keys.publicKey,
        configured: true,
        subscriberCount,
      });
    } catch (err: any) {
      console.error("[WebPush VAPID Key Error]:", err);
      return res
        .status(500)
        .json({ error: err.message || "Erro ao obter chave pública VAPID." });
    }
  }
);

app.get(["/api/v1/push/stats", "/api/push/stats"], async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }
    const subs = await getTenantPushSubscriptions(supabaseAdmin, tenantId);
    return res.status(200).json({
      success: true,
      tenantId,
      subscriberCount: subs.length,
    });
  } catch (err: any) {
    console.error("[WebPush Stats Error]:", err);
    return res
      .status(500)
      .json({ error: err.message || "Erro ao consultar inscritos Web Push." });
  }
});

const handleVerifyPushSubscription = async (
  req: express.Request,
  res: express.Response
) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const tenantId = String(
      req.query.tenantId ||
        req.query.tenant_id ||
        req.body?.tenantId ||
        req.body?.tenant_id ||
        ""
    ).trim();
    const endpoint = String(
      req.query.endpoint || req.body?.endpoint || ""
    ).trim();

    if (!endpoint) {
      return res.status(200).json({ success: true, exists: false });
    }

    const exists = await verifyPushSubscriptionExists(
      supabaseAdmin,
      tenantId,
      endpoint
    );

    return res.status(200).json({
      success: true,
      exists,
      tenantId: tenantId || null,
      endpoint,
    });
  } catch (err: any) {
    console.error("[WebPush Verify Error]:", err);
    return res.status(500).json({
      error: err.message || "Erro ao verificar subscrição Web Push.",
    });
  }
};

app.get(
  ["/api/v1/push/verify", "/api/push/verify", "/api/v1/push/check", "/api/push/check"],
  handleVerifyPushSubscription
);
app.post(
  ["/api/v1/push/verify", "/api/push/verify", "/api/v1/push/check", "/api/push/check"],
  handleVerifyPushSubscription
);

app.post(
  ["/api/v1/push/subscribe", "/api/push/subscribe"],
  async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const body = req.body || {};
      let tenantId = String(body.tenantId || body.tenant_id || "").trim();
      const oldEndpoint = String(body.oldEndpoint || body.old_endpoint || "").trim();
      const subscription = body.subscription || body;
      const endpoint = String(subscription?.endpoint || body.endpoint || "").trim();
      const p256dh = String(
        subscription?.keys?.p256dh || body.p256dh || ""
      ).trim();
      const auth = String(
        subscription?.keys?.auth || body.auth || ""
      ).trim();
      const userAgent = String(
        body.userAgent || body.user_agent || req.headers["user-agent"] || ""
      ).trim();

      let targetTenantIds: string[] = [];
      if (tenantId) {
        targetTenantIds = [tenantId];
      } else if (oldEndpoint) {
        // Quando o Service Worker renova a inscrição sem tenantId explícito,
        // preserva TODAS as drogarias em que o oldEndpoint estava inscrito.
        targetTenantIds = await resolveTenantIdsByEndpoint(supabaseAdmin, oldEndpoint);
      }

      if (targetTenantIds.length === 0) {
        return res
          .status(400)
          .json({ error: "tenant_id é obrigatório para inscrição Push." });
      }
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({
          error:
            "Dados de inscrição Push incompletos (endpoint, p256dh e auth são obrigatórios).",
        });
      }
      if (!isValidRealPushEndpoint(endpoint)) {
        return res.status(400).json({
          error:
            "Endpoint Web Push inválido ou fictício (preview-fallback bloqueado).",
        });
      }

      let primarySaved: any = null;
      for (const tid of targetTenantIds) {
        const saved = await savePushSubscription(supabaseAdmin, {
          tenantId: tid,
          endpoint,
          p256dh,
          auth,
          userAgent,
        });
        if (!primarySaved) primarySaved = saved;

        // Ao substituir um oldEndpoint durante auto-renovação, filtra sempre por tenant_id + oldEndpoint
        // garantindo que a loja B nunca apague nem sobrescreva a inscrição da loja A.
        if (oldEndpoint && oldEndpoint !== endpoint) {
          await removePushSubscriptionByEndpoint(supabaseAdmin, oldEndpoint, {
            tenantId: tid,
          }).catch(() => {});
        }
      }

      const primaryTenantId = targetTenantIds[0];
      const allSubs = await getTenantPushSubscriptions(supabaseAdmin, primaryTenantId);

      return res.status(200).json({
        success: true,
        subscription: primarySaved,
        subscriberCount: allSubs.length,
      });
    } catch (err: any) {
      console.error("[WebPush Subscribe Error]:", err);
      return res
        .status(500)
        .json({ error: err.message || "Erro ao registrar inscrição Web Push." });
    }
  }
);

app.post(["/api/v1/push/send", "/api/push/send"], async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const {
      tenantId,
      tenant_id,
      productId,
      product_id,
      title,
      body,
      message,
      imageUrl,
      image_url,
      targetUrl,
      target_url,
      iconUrl,
      icon_url,
    } = req.body || {};

    const resolvedTenantId = String(tenantId || tenant_id || "").trim();
    const resolvedProductId = String(productId || product_id || "").trim();
    const resolvedTitle = String(title || "").trim();
    const resolvedBody = String(body || message || "").trim();
    let resolvedImageUrl = String(imageUrl || image_url || "").trim();
    let resolvedTargetUrl = String(targetUrl || target_url || "").trim();
    let resolvedIconUrl = String(iconUrl || icon_url || "").trim();

    if (!resolvedTenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }
    if (!resolvedTitle || !resolvedBody) {
      return res
        .status(400)
        .json({ error: "Título e mensagem da notificação são obrigatórios." });
    }

    // Busca informações da loja caso iconUrl ou targetUrl não tenham sido informados
    let resolvedTenantSlug = slugifyStoreIdentifier(resolvedTenantId);
    try {
      const { data: tenantRow } = await supabaseAdmin
        .from("tenants")
        .select("id, slug, name, logo, logo_url")
        .eq("id", resolvedTenantId)
        .maybeSingle();

      if (tenantRow) {
        resolvedTenantSlug =
          slugifyStoreIdentifier(tenantRow.slug) ||
          slugifyStoreIdentifier(tenantRow.id) ||
          slugifyStoreIdentifier(tenantRow.name) ||
          resolvedTenantSlug;

        if (!resolvedIconUrl) {
          const rawLogo = String(tenantRow.logo_url || tenantRow.logo || "").trim();
          if (rawLogo.startsWith("http://") || rawLogo.startsWith("https://")) {
            resolvedIconUrl = rawLogo;
          } else if (rawLogo.startsWith("data:")) {
            resolvedIconUrl = `/api/v1/store/${encodeURIComponent(resolvedTenantId)}/logo.png`;
          }
        }
        if (!resolvedTargetUrl) {
          resolvedTargetUrl = resolvedProductId
            ? `/loja/${resolvedTenantSlug}?produto=${encodeURIComponent(resolvedProductId)}`
            : `/loja/${resolvedTenantSlug}`;
        }
      }
    } catch (_) {}

    if (!resolvedTargetUrl) {
      resolvedTargetUrl = resolvedProductId
        ? `/loja/${resolvedTenantSlug}?produto=${encodeURIComponent(resolvedProductId)}`
        : `/loja/${resolvedTenantSlug}`;
    } else if (
      resolvedProductId &&
      !resolvedTargetUrl.includes("produto=") &&
      !resolvedTargetUrl.includes("product=") &&
      !resolvedTargetUrl.includes("oferta=")
    ) {
      const sep = resolvedTargetUrl.includes("?") ? "&" : "?";
      resolvedTargetUrl = `${resolvedTargetUrl}${sep}produto=${encodeURIComponent(resolvedProductId)}`;
    }

    const result = await sendPromotionalPushToTenant(supabaseAdmin, {
      tenantId: resolvedTenantId,
      tenantSlug: resolvedTenantSlug,
      productId: resolvedProductId || undefined,
      title: resolvedTitle,
      body: resolvedBody,
      imageUrl: resolvedImageUrl || undefined,
      targetUrl: resolvedTargetUrl,
      iconUrl: resolvedIconUrl || "/icon-192.svg",
    });

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: result.summary,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        removedCount: result.removedCount,
        totalSubscribers: result.totalSubscribers,
        errorStatuses: result.errorStatuses,
        summary: result.summary,
        targetUrl: resolvedTargetUrl,
      });
    }

    return res.status(200).json({
      success: true,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      removedCount: result.removedCount,
      totalSubscribers: result.totalSubscribers,
      errorStatuses: result.errorStatuses,
      summary: result.summary,
      targetUrl: resolvedTargetUrl,
    });
  } catch (err: any) {
    console.error("[WebPush Send Error]:", err);
    return res
      .status(500)
      .json({ error: err.message || "Erro ao disparar notificações Web Push." });
  }
});

// ==============================================================================
// AGENDADOR AUTOMÁTICO EM BACKGROUND DO INOVAFARMA (POLLING A CADA 15 MINUTOS)
// ==============================================================================
let isInovafarmaCronRunning = false;

async function runInovafarmaAutoSyncScheduler(triggerSource = "cron_15m"): Promise<void> {
  if (isInovafarmaCronRunning) {
    console.log(
      `[INOVAFARMA CRON] Execução anterior ainda em andamento. Ignorando disparo (${triggerSource}) para evitar sobreposição.`,
    );
    return;
  }

  isInovafarmaCronRunning = true;
  try {
    const { data: allTenants, error: tenantsErr } = await supabaseAdmin
      .from("tenants")
      .select("*");

    if (tenantsErr || !allTenants || allTenants.length === 0) {
      return;
    }

    const inovafarmaTenants = allTenants.filter((t: any) => {
      if (t.is_blocked) return false;
      const erpType = String(t.erp_type || "").toLowerCase().trim();
      if (erpType !== "inovafarma") return false;
      const cfg = extractTenantErpConfig(t);
      const hasCreds = Boolean(
        (cfg.erp_login && cfg.has_erp_password) ||
          cfg.erp_access_token ||
          t.integration_token,
      );
      return hasCreds;
    });

    if (inovafarmaTenants.length === 0) {
      return;
    }

    console.log(
      `[INOVAFARMA CRON] Iniciando ciclo automático (${triggerSource}) para ${inovafarmaTenants.length} farmácia(s) Inovafarma...`,
    );

    for (const tenant of inovafarmaTenants) {
      const tenantId = String(tenant.id);
      const tenantName = tenant.name || tenant.slug || tenantId;
      const rawStoredSync =
        tenant.smart_banners?._erpCredentials?.last_product_sync ||
        tenant.last_product_sync ||
        "";
      const rawStoredSeen =
        tenant.smart_banners?._erpCredentials?.last_seen ||
        tenant.agent_last_seen ||
        tenant.last_seen ||
        "";

      // Se o valor atual de last_product_sync ou last_seen no banco estiver no futuro, sobrescreve imediatamente com new Date().toISOString()
      if (
        (rawStoredSync && new Date(rawStoredSync).getTime() > Date.now()) ||
        (rawStoredSeen && new Date(rawStoredSeen).getTime() > Date.now())
      ) {
        await touchInovafarmaHeartbeat(supabaseAdmin, tenantId, {
          lastProductSync: new Date().toISOString(),
        });
      }

      const cfg = extractTenantErpConfig(tenant);

      try {
        // a) Conectividade e Heartbeat (/api/v1/{slug}/server)
        const resolved = await resolveTenantInovafarmaToken({
          supabaseClient: supabaseAdmin,
          tenantId,
        });

        try {
          const serverRes = await checkInovafarmaServerConnectivity({
            baseUrl: resolved.baseUrl,
            routeId: resolved.routeId,
            token: resolved.token,
            cnpj: resolved.cnpj,
            apiKey: resolved.apiKey || undefined,
            supabaseClient: supabaseAdmin,
            tenantId,
          });
          if (serverRes.connected) {
            await touchInovafarmaHeartbeat(supabaseAdmin, tenantId);
          }
        } catch (connErr: any) {
          console.warn(
            `[INOVAFARMA CRON] Aviso no teste /server para ${tenantName} (${tenantId}):`,
            connErr?.message,
          );
        }

        // b) Sincronização Incremental (/produtosalterados) ou Carga Inicial em Lotes (/produtos)
        const hasInitialSync = Boolean(
          cfg.last_product_sync && String(cfg.last_product_sync).trim().length > 0,
        );

        let syncOffset = 1;
        let hasMoreBatches = true;
        let batchIteration = 0;
        const maxBatchesPerCycle = hasInitialSync ? 10 : 25;
        let cumReceived = 0;
        let cumCreated = 0;
        let cumUpdated = 0;
        let cumSkipped = 0;

        const dateRange = hasInitialSync
          ? deriveInovafarmaDateRange(undefined, undefined, cfg.last_product_sync)
          : undefined;

        while (hasMoreBatches && batchIteration < maxBatchesPerCycle) {
          batchIteration++;
          const batchResult = await syncInovafarmaProductsToSupabase(
            supabaseAdmin,
            {
              tenantId,
              erpUrl: resolved.baseUrl,
              erpRouteId: resolved.routeId,
              apiToken: resolved.token,
              apiKey: resolved.apiKey || undefined,
              cnpj: resolved.cnpj,
              ignoreErpPrices: cfg.ignore_erp_prices,
              mode: hasInitialSync ? "delta" : "full",
              ...(dateRange
                ? { inicial: dateRange.inicial, final: dateRange.final }
                : {}),
              offset: syncOffset,
              limit: 500,
              maxPages: 3,
              cumulativeReceived: cumReceived,
              cumulativeCreated: cumCreated,
              cumulativeUpdated: cumUpdated,
              cumulativeSkipped: cumSkipped,
            },
            (name, category) => {
              const c = classifyProductCategory(name, undefined, category || "");
              return {
                department: c.department,
                category: c.subcategory,
                subcategory: c.subcategory,
              };
            },
          );

          cumReceived += Number(batchResult.receivedCount ?? batchResult.totalFetched ?? 0);
          cumCreated += Number(batchResult.createdCount ?? batchResult.insertedCount ?? 0);
          cumUpdated += Number(batchResult.updatedCount ?? 0);
          cumSkipped += Number(batchResult.skippedCount ?? 0);

          if (
            batchResult.partial &&
            batchResult.nextOffset &&
            batchResult.nextOffset > syncOffset
          ) {
            syncOffset = batchResult.nextOffset;
          } else {
            hasMoreBatches = false;
          }
        }

        if (cumCreated > 0 || cumUpdated > 0) {
          console.log(
            `[INOVAFARMA CRON] Produtos sincronizados para ${tenantName}: ${cumReceived} recebidos (${cumCreated} novos, ${cumUpdated} atualizados).`,
          );
        }

        // c) Conciliação Automática de Pedidos (POST /Venda pendentes + GET /vendaporid)
        try {
          const reconcileRes = await reconcilePendingInovafarmaOrders(
            supabaseAdmin,
            {
              tenantId,
              baseUrl: resolved.baseUrl,
              routeId: resolved.routeId,
              cnpj: resolved.cnpj,
              apiKey: resolved.apiKey || undefined,
            },
          );
          if (reconcileRes.sentPendingCount > 0 || reconcileRes.reconciledCount > 0) {
            console.log(
              `[INOVAFARMA CRON] Conciliação de vendas para ${tenantName}: ${reconcileRes.sentPendingCount} enviada(s), ${reconcileRes.reconciledCount} conciliada(s).`,
            );
          }
        } catch (recErr: any) {
          console.warn(
            `[INOVAFARMA CRON] Aviso ao conciliar pedidos para ${tenantName} (${tenantId}):`,
            recErr?.message,
          );
        }
      } catch (tenantErr: any) {
        console.error(
          `[INOVAFARMA CRON] Erro ao processar farmácia ${tenantName} (${tenantId}):`,
          tenantErr?.message || tenantErr,
        );
      }
    }
  } catch (err: any) {
    console.error("[INOVAFARMA CRON] Erro inesperado no agendador:", err?.message || err);
  } finally {
    isInovafarmaCronRunning = false;
  }
}

async function startServer() {
  const listenPort = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== "production") {
    let viteMiddleware: any = null;
    const viteReady = (async () => {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
        },
        appType: "spa",
      });
      viteMiddleware = vite.middlewares;
    })().catch((err) => {
      console.error("[Vite Init Error]:", err);
    });

    app.use(async (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(404).json({
          error: `Rota de API não encontrada: ${req.method} ${req.path}`,
        });
      }
      if (!viteMiddleware) {
        await viteReady;
      }
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      next();
    });
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      maxAge: '1d',
      setHeaders: (res, filepath) => {
        if (
          filepath.endsWith('.html') || 
          filepath.endsWith('sw.js') || 
          filepath.endsWith('manifest.json')
        ) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
        if (filepath.endsWith('sw.js')) {
          res.setHeader('Service-Worker-Allowed', '/');
        }
      }
    }));

    // SPA Fallback: qualquer rota GET que não comece com /api/ ou /s/ entrega o dist/index.html direto da RAM em < 5ms
    app.get("*all", async (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/s/")) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const htmlFromRam = getIndexHtmlFromRam();
      if (htmlFromRam) {
        try {
          if (acceptsHtmlForSeo(req)) {
            const { host } = resolveRequestOrigin(req);
            const lowerHost = host.toLowerCase();
            const isSubdomain =
              (lowerHost.endsWith(".farmaflow.online") || lowerHost.endsWith(".nexoia.online")) &&
              !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(lowerHost.split(".")[0]);
            if (isSubdomain) {
              const subdomainId = lowerHost.split(".")[0];
              const meta = await withSeoTimeout(getTenantMetaRecord(subdomainId, req), SEO_LOOKUP_TIMEOUT_MS);
              if (meta) {
                res.setHeader("X-SEO-Injected", meta.ogType === "product" ? "product" : "store");
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                return res.status(200).send(injectStoreMetaIntoHtml(htmlFromRam, meta));
              }
            }
          }
        } catch {
          // Fallback silencioso para o HTML padrão
        }
        res.setHeader("X-SEO-Injected", "fallback");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(htmlFromRam);
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(listenPort, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${listenPort}`);

    // Pré-aquece o cache em RAM de todas as drogarias e garante que todas as logos tenham < 200KB para o WhatsApp Open Graph
    void (async () => {
      try {
        const { data: tenants } = await supabaseAdmin.from("tenants").select("*");
        if (Array.isArray(tenants)) {
          allTenantsRamCache = {
            list: tenants,
            expiresAt: Date.now() + TENANT_RAM_CACHE_TTL_MS,
          };
          for (const t of tenants) {
            const updates: Record<string, any> = {};
            if (!t.slug && t.id) {
              updates.slug = t.id;
              t.slug = t.id;
            }
            const currentLogo = String(t.logo_url || t.logo || "").trim();
            if (currentLogo.startsWith("http")) {
              try {
                const checkRes = await fetch(currentLogo);
                if (checkRes.ok) {
                  const origBuf = Buffer.from(await checkRes.arrayBuffer());
                  if (origBuf.length > 200 * 1024) {
                    const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(currentLogo)}&w=600&h=600&fit=cover&output=jpg&q=82`;
                    const optRes = await fetch(wsrvUrl);
                    if (optRes.ok) {
                      const optBuf = Buffer.from(await optRes.arrayBuffer());
                      const safeId = String(t.id).replace(/[^a-zA-Z0-9_-]/g, "_");
                      const newPath = `logos/${safeId}_logo_og_${Date.now()}.jpg`;
                      const { error: upErr } = await supabaseAdmin.storage
                        .from("product-images")
                        .upload(newPath, optBuf, {
                          contentType: "image/jpeg",
                          cacheControl: "86400",
                          upsert: true,
                        });
                      if (!upErr) {
                        const { data: pubData } = supabaseAdmin.storage.from("product-images").getPublicUrl(newPath);
                        if (pubData?.publicUrl) {
                          updates.logo_url = pubData.publicUrl;
                          updates.logo = pubData.publicUrl;
                          t.logo_url = pubData.publicUrl;
                          t.logo = pubData.publicUrl;
                          console.log(`[OG_BOOT_OPTIMIZER] Logo de ${t.id} otimizada para WhatsApp (${Math.round(origBuf.length / 1024)}KB -> ${Math.round(optBuf.length / 1024)}KB)`);
                        }
                      }
                    }
                  }
                }
              } catch (_) {}
            }
            if (Object.keys(updates).length > 0) {
              await supabaseAdmin.from("tenants").update(updates).eq("id", t.id);
            }
            storeTenantInRamCache(t);
          }
        }
      } catch (e: any) {
        console.warn("[OG_BOOT_OPTIMIZER Warning]:", e?.message || e);
      }
    })();

    // Inicializa chaves VAPID e tabela push_subscriptions no boot
    ensurePushSubscriptionsTable()
      .then(() => getOrInitVapidKeys(supabaseAdmin))
      .catch((err) =>
        console.warn("[WebPush Startup Init Warning]:", err?.message || err),
      );

    // Inicia o agendador automático do Inovafarma a cada 15 minutos (900.000 ms)
    const INOVAFARMA_POLL_INTERVAL_MS = 15 * 60 * 1000;
    setInterval(() => {
      runInovafarmaAutoSyncScheduler("interval_15m").catch((err) =>
        console.error("[INOVAFARMA CRON INTERVAL ERROR]:", err),
      );
    }, INOVAFARMA_POLL_INTERVAL_MS);

    // Executa limpeza automática de fotos inválidas (banners Meli+, ícones gavel/flaticon e genéricos sobrescritos) no boot
    setTimeout(() => {
      cleanupCorruptedEanImages(supabaseAdmin).catch((err) =>
        console.warn("[EAN IMAGE CLEANUP STARTUP WARNING]:", err?.message || err),
      );
    }, 5 * 1000);

    // Corrige automaticamente no boot produtos que tenham ficado com price <= 0 mas possuam original_price > 0 (ex: sincronizados do Siagold antes do fallback)
    setTimeout(async () => {
      try {
        const { data: zeroPriceRows, error: zeroErr } = await supabaseAdmin
          .from("products")
          .select("id, tenant_id, price, original_price")
          .or("price.lte.0,price.is.null")
          .gt("original_price", 0)
          .limit(2000);

        if (!zeroErr && zeroPriceRows && zeroPriceRows.length > 0) {
          let fixedZeroCount = 0;
          const affectedTenants = new Set<string>();
          for (const row of zeroPriceRows) {
            const origVal = Number(row.original_price);
            if (origVal > 0) {
              const { error: updErr } = await supabaseAdmin
                .from("products")
                .update({ price: origVal })
                .eq("id", row.id);
              if (!updErr) {
                fixedZeroCount++;
                if (row.tenant_id) affectedTenants.add(String(row.tenant_id));
              }
            }
          }
          for (const tId of affectedTenants) {
            tenantProductHashCache.delete(tId);
          }
          if (fixedZeroCount > 0) {
            console.log(
              `[Price Fallback Startup Fix] ${fixedZeroCount} produto(s) com preco_venda <= 0 atualizado(s) automaticamente com preco_original (PMC).`,
            );
          }
        }
      } catch (fixErr: any) {
        console.warn("[Price Fallback Startup Warning]:", fixErr?.message || fixErr);
      }
    }, 3 * 1000);

    // Dispara uma verificação inicial rápida após o boot do servidor (15 segundos)
    setTimeout(() => {
      runInovafarmaAutoSyncScheduler("startup_initial_check").catch((err) =>
        console.error("[INOVAFARMA CRON STARTUP ERROR]:", err),
      );
    }, 15 * 1000);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}

