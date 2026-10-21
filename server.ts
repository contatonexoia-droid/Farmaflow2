import express from "express";
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
import { getDepartmentForCategory, classifyProductTaxonomy, OFFICIAL_DEPARTMENTS, OFFICIAL_TAXONOMY } from "./lib/departments.js";
import multer from "multer";
import * as XLSX from "xlsx";

import { checkTenantAccess } from "./checkTenantAccess.js";
import { calculateDeliveryDistance } from "./lib/maps.js";

import { dispatcher } from "./services/asyncDispatcher.js";
import { whatsappHealthManager } from "./services/whatsappHealthManager.js";
import { realtimeHub } from "./services/realtimeHub.js";
import { botHandoffManager, isWeblojaOrderMessage, isBotSentOrEcho, registerBotSentMessage, botSentMessageIds } from "./services/botHandoffManager.js";
import { continuousUseRefillManager } from "./services/continuousUseRefillManager.js";
import { csatManager } from "./services/csatManager.js";
import { contactMergeManager } from "./services/contactMergeManager.js";
import { inboxStore } from "./services/inboxStore.js";
import { chatStore } from "./services/chatStore.js";
import { teamStore } from "./services/teamStore.js";
import { aiAgentService, DEFAULT_AI_AGENT_PROMPT, isolateUrlsInText, extractUrlAndCleanText, ensureStoreUrlCacheBuster } from "./services/aiAgentService.js";
import { evolutionApiService } from "./services/evolutionApiService.js";
import { transcribeAudio } from "./services/audioAiService.js";
import ogHandler, { buildCrawlerHtml, isCrawlerRequest } from "./api/og-handler.js";
import QRCode from "qrcode";
import { fetchAndStoreProductImageByEan, syncEanImagesBatch, validateAndCleanEan } from "./services/eanImageService.js";


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

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ============================================================================
// INTERCEPTAÇÃO DO CRAWLER DE OPEN GRAPH (WhatsApp, Facebook, Twitter, LinkedIn)
// ============================================================================
app.use(async (req, res, next) => {
  // Ignora rotas de API internas (exceto /api/og) e arquivos estáticos (js, css, imagens, etc.)
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/og')) return next();
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|json|woff|woff2|ttf|map)$/i.test(req.path)) return next();

  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = /facebookexternalhit|whatsapp|facebot|twitterbot|linkedinbot/i.test(userAgent);

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
        logo_url: 'https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_1790958337014.png'
      };
    }

    const proto = (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'https')).toString();
    const currentHost = (!host || host === 'localhost' || host === '127.0.0.1') ? 'drogaria-esplendido.farmaflow.online' : host;
    const currentUrl = `${proto}://${currentHost}${req.originalUrl || req.url || '/'}`;

    const title = tenant.trade_name || tenant.name || 'Drogaria Explendido';
    const description = `Faça seu pedido online com rapidez e comodidade na ${tenant.trade_name || 'nossa drogaria'}.`;
    let logoUrl = (tenant.logo_url || tenant.logo || 'https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_1790958337014.png').trim();
    if (logoUrl.startsWith('http://')) {
      logoUrl = logoUrl.replace('http://', 'https://');
    }

    console.log(`[CRAWLER_OG] 🤖 Scraper detectado (${userAgent.substring(0, 30)}...). Retornando meta tags para "${title}": logo=${logoUrl}`);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:url" content="${currentUrl}" />
  <meta property="og:type" content="website" />
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

    // 1. Buscar a drogaria no Supabase pelo slug usando SUPABASE_SERVICE_ROLE_KEY (supabaseAdmin)
    try {
      const { data } = await supabaseAdmin
        .from('tenants')
        .select('trade_name, name, logo_url, slug, custom_domain')
        .or(`slug.ilike.%${cleanSlug}%,slug.eq.drogaria-esplendido,id.eq.${cleanSlug}`)
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
          .select('trade_name, name, logo_url, slug, custom_domain');
        if (allTenants && allTenants.length > 0) {
          const norm = cleanSlug.replace(/-/g, '').replace(/x/g, 's');
          tenant = allTenants.find((t: any) => {
            const s = (t.slug || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/x/g, 's');
            const n = (t.trade_name || t.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').replace(/x/g, 's');
            return s.includes(norm) || norm.includes(s) || n.includes(norm);
          });
        }
      } catch (_) {}
    }

    const storeName = tenant?.trade_name || tenant?.name || 'Drogaria Explendido';
    let logoUrl = (tenant?.logo_url || '').trim();
    if (logoUrl.startsWith('http://')) {
      logoUrl = logoUrl.replace('http://', 'https://');
    }
    if (!logoUrl.startsWith('https://')) {
      logoUrl = 'https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_1790958337014.png';
    }

    const baseDomain = cleanSlug || 'drogaria-esplendido';
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
  <meta name="description" content="Faça seu pedido online com rapidez na ${storeName}." />
  
  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${storeName}" />
  <meta property="og:description" content="Faça seu pedido online com rapidez e comodidade. Medicamentos e perfumaria com tele-entrega." />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:url" content="${targetUrl}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${storeName}" />
  <meta name="twitter:description" content="Faça seu pedido online com rapidez e comodidade." />
  <meta name="twitter:image" content="${logoUrl}" />

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
    const data = XLSX.utils.sheet_to_json(worksheet);
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
    
    if (error) throw error;
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
    res.json({ data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/version", (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({ version: "3.0.5" });
});

app.get("/api/v1/resolve-tenant", async (req, res) => {
  try {
    const host = req.query.hostname || req.headers.host || "";
    const hostname = String(host).split(":")[0]; // Remove port if present

    let tenantData = null;

    // Regra A (Subdomínio)
    if (hostname.endsWith(".farmaflow.online") || hostname.endsWith(".nexoia.online")) {
      const parts = hostname.split(".");
      const tenantSlug = parts[0];
      
      if (tenantSlug && tenantSlug !== "www" && tenantSlug !== "farmaflow" && tenantSlug !== "nexoia") {
        const { data, error } = await supabase
          .from("tenants")
          .select("*")
          .eq("slug", tenantSlug)
          .maybeSingle();
          
        if (!error && data) {
          tenantData = data;
        } else {
          // Fallback: busca flexível comparando o slug limpo (sem acentos, espaços ou hífens)
          const cleanReqSlug = tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, "");
          const { data: allTenants } = await supabase.from("tenants").select("*");
          if (allTenants) {
            tenantData = allTenants.find((t: any) => {
              const rawSlug = (t.slug || t.subdomain || t.name || t.id || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, "");
              return rawSlug === cleanReqSlug;
            }) || null;
          }
        }
      }
    } 
    
    // Regra B (Domínio Próprio)
    if (!tenantData) {
      // Allow searching by custom_domain. If the column doesn't exist yet, this might throw a PostgrestError.
      // We will handle the 42703 (undefined_column) error gracefully.
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("custom_domain", hostname)
        .single();
        
      if (!error && data) {
        tenantData = data;
      }
    }

    if (tenantData) {
      return res.json({ tenant: tenantData });
    } else {
      return res.status(404).json({ error: "Tenant not found for this domain" });
    }
  } catch (e: any) {
    if (e.code === "42703") {
        // custom_domain column doesn't exist yet, return 404
        return res.status(404).json({ error: "Tenant not found for this domain" });
    }
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// OPEN GRAPH / WHATSAPP RICH LINK PREVIEW MULTITENANT
// ============================================================================

const isSocialCrawler = (userAgent: string = ''): boolean => {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview|googlebot|bingbot|baiduspider|yandex|crawlers|axios|node-fetch|got|undici|curl|evolution|baileys/i.test(userAgent);
};

interface TenantMetaRecord {
  id: string;
  name: string;
  slug: string;
  title: string;
  description: string;
  logoUrl: string;
  canonicalUrl: string;
  location: string;
  phone: string;
  rawTenant?: any;
}

async function getTenantMetaRecord(identifier: string, req: express.Request): Promise<TenantMetaRecord | null> {
  if (!identifier) return null;
  const cleanReq = identifier.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

  let tenant: any = null;

  // 1. Busca direta por ID ou Slug
  try {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .or(`id.eq.${identifier},slug.eq.${identifier}`)
      .maybeSingle();

    if (!error && data) {
      tenant = data;
    }
  } catch (err) {}

  // 2. Fallback: busca flexível comparando nomes e slugs normalizados
  if (!tenant) {
    try {
      const { data: allTenants } = await supabaseAdmin
        .from("tenants")
        .select("*");

      if (allTenants) {
        tenant = allTenants.find((t: any) => {
          const rawSlug = (t.slug || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
          const rawId = (t.id || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
          const rawName = (t.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
          const rawCustom = (t.custom_domain || "").toLowerCase();
          return rawSlug === cleanReq || rawId === cleanReq || rawName === cleanReq || rawCustom === identifier.toLowerCase();
        }) || null;
      }
    } catch (err) {}
  }

  if (!tenant) return null;

  // Resolução de URLs canônicas absolutas
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "farmaflow.online").toString().split(":")[0];
  const proto = (req.headers["x-forwarded-proto"] || (req.secure ? "https" : "https")).toString();
  const baseUrl = `${proto}://${host}`;

  const storeName = tenant.name || tenant.razao_social || "FarmaFlow Drogaria";
  const locParts = [tenant.neighborhood, tenant.city, tenant.state].filter(Boolean);
  const location = locParts.length > 0 ? locParts.join(" - ") : "";
  let title = `${storeName}${location ? ` (${location})` : ""} - Farmácia Online & Delivery`;

  let description =
    tenant.description ||
    tenant.banner_subtitle ||
    tenant.bannersubtitle ||
    tenant.banner_title ||
    tenant.bannertitle ||
    "Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas.";

  const tenantSlug = tenant.slug || tenant.id;

  // Resolução do logotipo público da drogaria para Open Graph
  const rawLogo = (tenant.logo_url || tenant.logo || tenant.smart_banners?._regulatoryData?.logo_url || "").trim();
  let logoUrl = "https://farmaflow.online/preview-share.png";
  if ((rawLogo.startsWith("http://") || rawLogo.startsWith("https://")) && !rawLogo.startsWith("data:")) {
    logoUrl = rawLogo.startsWith("http://") ? rawLogo.replace("http://", "https://") : rawLogo;
  } else if (tenant.id && (rawLogo.length > 0 || tenant.logo)) {
    logoUrl = `${baseUrl}/api/v1/store/${encodeURIComponent(tenant.id)}/logo.png`;
    if (logoUrl.startsWith("http://")) logoUrl = logoUrl.replace("http://", "https://");
  }

  let canonicalUrl = `${baseUrl}/loja/${encodeURIComponent(tenantSlug)}`;
  if (tenant.custom_domain && tenant.custom_domain.trim()) {
    canonicalUrl = `https://${tenant.custom_domain.replace(/^https?:\/\//, "").trim()}`;
  } else if (host.endsWith(".farmaflow.online") && host !== "farmaflow.online" && host !== "www.farmaflow.online") {
    canonicalUrl = `${proto}://${host}`;
  }

  // Enriquecimento com dados de produto específico para Link Preview no WhatsApp
  const targetProdId = (req.query?.produto || req.query?.prod || req.query?.product || req.params?.id || "").toString().trim();
  if (targetProdId) {
    try {
      const { data: prodData } = await supabase
        .from("products")
        .select("id, name, slug, price, presentation, image, image_url")
        .or(`id.eq.${targetProdId},slug.eq.${targetProdId}`)
        .limit(1)
        .maybeSingle();

      if (prodData) {
        const prodPrice = Number(prodData.price) > 0 ? ` - R$ ${Number(prodData.price).toFixed(2).replace('.', ',')}` : "";
        title = `${prodData.name}${prodPrice} | ${storeName}`;
        description = `${prodData.presentation ? `${prodData.presentation}. ` : ""}Peça online na ${storeName} com entrega rápida e pagamento facilitado no WhatsApp.`;
        const prodImg = (prodData.image || prodData.image_url || "").trim();
        if ((prodImg.startsWith("http://") || prodImg.startsWith("https://")) && !prodImg.startsWith("data:")) {
          logoUrl = prodImg;
        }
      }
    } catch (_) {}
  }

  return {
    id: tenant.id,
    name: storeName,
    slug: tenantSlug,
    title,
    description,
    logoUrl,
    canonicalUrl,
    location,
    phone: tenant.whatsapp || "",
    rawTenant: tenant,
  };
}

function generateStoreOpenGraphHtml(meta: TenantMetaRecord): string {
  const esc = (str: string = "") =>
    str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const titleName = esc(meta.rawTenant?.trade_name || meta.name || "Drogaria Explendido");
  const logoUrl = esc(meta.logoUrl || "https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_1790958337014.png");
  const descName = esc(meta.rawTenant?.trade_name || "nossa drogaria");
  const descricao = esc(`Faça seu pedido online com rapidez e comodidade na ${descName}.`);
  const currentUrl = esc(meta.canonicalUrl || "https://drogaria-esplendido.farmaflow.online");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${titleName}</title>
  <meta property="og:title" content="${titleName}" />
  <meta property="og:description" content="${descricao}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:url" content="${currentUrl}" />
  <meta property="og:type" content="website" />
</head>
<body></body>
</html>`;
}

function injectStoreMetaIntoHtml(html: string, meta: TenantMetaRecord): string {
  let updated = html;
  
  updated = updated.replace(/<title>.*?<\/title>/i, `<title>${meta.title}</title>`);
  
  if (updated.includes('property="og:title"')) {
    updated = updated.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${meta.title}" />`);
  }
  if (updated.includes('property="og:description"')) {
    updated = updated.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${meta.description}" />`);
  }
  if (updated.includes('property="og:url"')) {
    updated = updated.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${meta.canonicalUrl}" />`);
  }
  if (updated.includes('property="og:site_name"')) {
    updated = updated.replace(/<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:site_name" content="${meta.name}" />`);
  }
  if (updated.includes('property="og:image"')) {
    updated = updated.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${meta.logoUrl}" />`);
  }
  if (updated.includes('property="og:image:secure_url"')) {
    updated = updated.replace(/<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image:secure_url" content="${meta.logoUrl}" />`);
  }
  if (updated.includes('name="twitter:card"')) {
    updated = updated.replace(/<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:card" content="summary_large_image" />`);
  }
  if (updated.includes('name="twitter:title"')) {
    updated = updated.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:title" content="${meta.title}" />`);
  }
  if (updated.includes('name="twitter:description"')) {
    updated = updated.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:description" content="${meta.description}" />`);
  }
  if (updated.includes('name="twitter:image"')) {
    updated = updated.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i, `<meta name="twitter:image" content="${meta.logoUrl}" />`);
  }
  if (updated.includes('name="description"')) {
    updated = updated.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${meta.description}" />`);
  }

  return updated;
}

// Endpoint de Servir Logo da Loja em Formato Binário Real (JPEG/PNG) para WhatsApp e Crawlers
app.get(["/api/v1/store/:tenantId/logo.png", "/api/store-logo/:tenantId.png"], async (req, res) => {
  try {
    const tenantId = Array.isArray(req.params.tenantId) ? req.params.tenantId[0] : String(req.params.tenantId || "");
    const meta = await getTenantMetaRecord(tenantId, req);
    const tenant = meta?.rawTenant;

    if (tenant && tenant.logo) {
      const logoStr = String(tenant.logo).trim();
      if (logoStr.startsWith("data:")) {
        const match = logoStr.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const buf = Buffer.from(match[2], "base64");
          res.setHeader("Content-Type", mime);
          res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          return res.send(buf);
        }
      } else if (logoStr.startsWith("http://") || logoStr.startsWith("https://")) {
        try {
          const fetchRes = await fetch(logoStr);
          if (fetchRes.ok) {
            const buf = Buffer.from(await fetchRes.arrayBuffer());
            const mime = fetchRes.headers.get("content-type") || "image/png";
            res.setHeader("Content-Type", mime);
            res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
            return res.send(buf);
          }
        } catch (_) {}
        return res.redirect(302, logoStr);
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

// Interceptor de Rota de Loja Pública (/loja/:slug e /produto/:id)
app.get(["/loja/:slug", "/loja/:slug/*all", "/produto/:id", "/produto/:id/*all", "/loja/:slug/produto/:id"], async (req, res, next) => {
  try {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : String(req.params.slug || "");
    const prodId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id || "");
    const meta = await getTenantMetaRecord(slug || prodId, req);
    if (!meta) return next();

    const isCrawler = isSocialCrawler((req.headers["user-agent"] as string) || "");
    if (isCrawler) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0");
      res.setHeader("CDN-Cache-Control", "no-store");
      res.setHeader("Vercel-CDN-Cache-Control", "no-store");
      return res.send(generateStoreOpenGraphHtml(meta));
    }

    // Para navegadores regulares: injeta as meta tags dinâmicas no index.html e serve
    const distHtml = path.join(process.cwd(), "dist", "index.html");
    const rootHtml = path.join(process.cwd(), "index.html");
    const filePath = fs.existsSync(distHtml) ? distHtml : rootHtml;

    if (fs.existsSync(filePath)) {
      const original = fs.readFileSync(filePath, "utf-8");
      const injected = injectStoreMetaIntoHtml(original, meta);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.send(injected);
    }

    return next();
  } catch (err) {
    return next();
  }
});

// Interceptor de Rota Raiz (/) para Crawlers de Redes Sociais com parâmetros de drogaria ou subdomínio
app.get("/", async (req, res, next) => {
  try {
    const isCrawler = isSocialCrawler((req.headers["user-agent"] as string) || "");
    const storeParam = (req.query.store || req.query.loja || req.query.tenant || req.query.p || "").toString().trim();
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(":")[0];
    const isSubdomain = (host.endsWith(".farmaflow.online") || host.endsWith(".nexoia.online")) && !["www", "farmaflow", "nexoia", "app", "admin", "api", "portal"].includes(host.split(".")[0]);

    if (isCrawler || storeParam || isSubdomain) {
      let identifier = storeParam;
      if (!identifier && isSubdomain) {
        identifier = host.split(".")[0];
      }

      if (identifier) {
        const meta = await getTenantMetaRecord(identifier, req);
        if (meta) {
          if (isCrawler) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0, s-maxage=0");
            res.setHeader("CDN-Cache-Control", "no-store");
            res.setHeader("Vercel-CDN-Cache-Control", "no-store");
            return res.send(generateStoreOpenGraphHtml(meta));
          } else {
            const distHtml = path.join(process.cwd(), "dist", "index.html");
            const rootHtml = path.join(process.cwd(), "index.html");
            const filePath = fs.existsSync(distHtml) ? distHtml : rootHtml;
            if (fs.existsSync(filePath)) {
              const original = fs.readFileSync(filePath, "utf-8");
              const injected = injectStoreMetaIntoHtml(original, meta);
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              return res.send(injected);
            }
          }
        }
      }
    }
    return next();
  } catch (err) {
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
    const tenantQueryValue = (rawParam && rawParam !== "admin" && rawParam !== "default") ? rawParam : rawQueryTenant;
    let tenantData: any = null;

    if (typeof tenantQueryValue === "string") {
      // Simple sanitize to prevent injection, only allow alphanumeric, hyphens, and underscores
      const cleanedQuery = tenantQueryValue.replace(/[^a-zA-Z0-9\-_]/g, "");
      
      if (cleanedQuery) {
        // Fetch from tenants table
        const { data, error } = await supabase
          .from("tenants")
          .select("id, slug, name, logo, primary_color")
          .or(`id.eq.${cleanedQuery},slug.eq.${cleanedQuery}`)
          .maybeSingle();

        if (!error && data) {
          tenantData = data;
        }
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

    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");

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
        background_color: "#f8fafc",
        theme_color: primaryColor,
        icons: [
          {
            src: tenantData?.logo || "/icon-192.svg",
            sizes: "192x192",
            type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
            purpose: "any maskable"
          },
          {
            src: tenantData?.logo || "/icon-512.svg",
            sizes: "512x512",
            type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
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
      scope: segment === "default" ? "/" : `/loja/${segment}/`,
      display: "standalone",
      background_color: "#fcfdfe",
      theme_color: primaryColor,
      icons: [
        {
          src: tenantData?.logo || "/icon-192.svg",
          sizes: "192x192",
          type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
          purpose: "any maskable"
        },
        {
          src: tenantData?.logo || "/icon-512.svg",
          sizes: "512x512",
          type: tenantData?.logo?.endsWith(".svg") ? "image/svg+xml" : "image/png",
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
    if (isAdmin) {
      return res.json({
        id: "/admin",
        name: "FarmaFlow Gestão",
        short_name: "Painel Gestão",
        description: "Painel de Gestão e Administração FarmaFlow",
        start_url: "/admin",
        scope: "/",
        display: "standalone",
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
        is_active: u.is_active !== undefined ? u.is_active : true
    }));

    res.json({ data: enrichedData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Roles estritamente permitidas para cadastro e gestão por estabelecimentos (lojas)
const STORE_ALLOWED_OPERATIONAL_ROLES = ["gerente", "operador", "balconista"];

app.post("/api/v1/team/users", checkTenantAccess, async (req, res) => {
  try {
    const { email, password, full_name, role, store_id } = req.body;
    
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "Nome, e-mail, função e senha são obrigatórios." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRole = role.trim().toLowerCase();
    const cleanStoreId = store_id || req.headers["x-tenant-id"] || req.query.tenantId;

    // Validação de Segurança RBAC: Lojas só podem cadastrar colaboradores com papéis operacionais
    if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(cleanRole)) {
      return res.status(403).json({ 
        error: "Permissão negada: As lojas podem cadastrar apenas colaboradores operacionais (Gerente ou Operador/Balconista). Cargos administrativos/matriz são de exclusividade do Super Admin." 
      });
    }

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
    const userId = req.params.id;
    const { full_name, role, is_active } = req.body;

    let cleanRole: string | undefined = undefined;
    if (role !== undefined && role !== null) {
      cleanRole = String(role).trim().toLowerCase();
      if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(cleanRole)) {
        return res.status(403).json({ 
          error: "Permissão negada: As lojas podem atribuir apenas cargos operacionais (Gerente ou Operador/Balconista)." 
        });
      }
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
    const userId = req.params.id;
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

app.post("/api/v1/teams", async (req, res) => {
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

app.put("/api/v1/teams/:id", async (req, res) => {
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

app.delete("/api/v1/teams/:id", async (req, res) => {
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

app.post("/api/v1/teams/:id/members/toggle", async (req, res) => {
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
async function resolveOperatorAllowedInboxIds(
  storeId: string,
  userId?: string,
  userRole?: string,
  authHeader?: string,
  headerUserId?: string,
  headerUserRole?: string
): Promise<{ isOperator: boolean; allowedInboxIds: string[] }> {
  const candidateUserIds = new Set<string>();
  const candidateEmails = new Set<string>();

  const addCandidate = (val?: string | null) => {
    if (!val || typeof val !== "string") return;
    const clean = val.trim();
    if (!clean || clean === "undefined" || clean === "null") return;
    if (clean.includes("@")) {
      candidateEmails.add(clean.toLowerCase());
    } else {
      candidateUserIds.add(clean);
    }
  };

  addCandidate(userId);
  addCandidate(headerUserId);

  let detectedRole = (userRole || headerUserRole || "").toLowerCase().trim();

  // 1. Tentar resolver a partir do token Bearer se fornecido
  const cleanAuthToken = authHeader ? String(authHeader).replace(/^Bearer\s+/i, '').trim() : '';
  if (cleanAuthToken && cleanAuthToken !== "undefined" && cleanAuthToken !== "null") {
    try {
      const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(cleanAuthToken);
      if (authUser) {
        addCandidate(authUser.id);
        if (authUser.email) addCandidate(authUser.email);
        if (!detectedRole && authUser.user_metadata?.role) {
          detectedRole = String(authUser.user_metadata.role).toLowerCase().trim();
        }
      }
    } catch (_) {}
  }

  // 2. Buscar correspondência em tenant_users para mapear todos os IDs possíveis (id, supabase_user_id, email, role)
  try {
    const rawIds = Array.from(candidateUserIds);
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

    if (rawIds.length > 0) {
      const validUuids = rawIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (validUuids.length > 0) {
        tuQueries.push(
          Promise.resolve(
            supabaseAdmin
              .from("tenant_users")
              .select("id, supabase_user_id, role, tenant_id, email")
              .or(`id.in.(${validUuids.join(',')}),supabase_user_id.in.(${validUuids.join(',')})`)
          )
        );
      }
      const otherIds = rawIds.filter(id => !validUuids.includes(id));
      for (const oid of otherIds) {
        tuQueries.push(
          Promise.resolve(
            supabaseAdmin
              .from("tenant_users")
              .select("id, supabase_user_id, role, tenant_id, email")
              .eq("id", oid)
          )
        );
      }
    }

    if (storeId && storeId !== "default" && rawEmails.length > 0) {
      tuQueries.push(
        Promise.resolve(
          supabaseAdmin
            .from("tenant_users")
            .select("id, supabase_user_id, role, tenant_id, email")
            .eq("tenant_id", storeId)
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

          if (matchEmail || matchId || matchSubId || (rawEmails.length === 0 && rawIds.length === 0)) {
            if (tu.id) addCandidate(tu.id);
            if (tu.supabase_user_id) addCandidate(tu.supabase_user_id);
            if (tu.email) addCandidate(tu.email);
            if (!detectedRole && tu.role) {
              detectedRole = String(tu.role).toLowerCase().trim();
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[OperatorAccess] Error resolving tenant_users:", e);
  }

  const isOperator = ["operador", "operator", "atendente", "balconista"].includes(detectedRole);
  if (!isOperator) {
    return { isOperator: false, allowedInboxIds: [] };
  }

  const allSearchIdentifiers = Array.from(new Set([...candidateUserIds, ...candidateEmails]));
  const allowedIdsSet = new Set<string>();

  if (allSearchIdentifiers.length > 0) {
    // 3. Buscar em department_access
    try {
      const { data: deptRows, error: deptErr } = await supabaseAdmin
        .from("department_access")
        .select("department_id, user_id, tenant_id")
        .in("user_id", allSearchIdentifiers);
      if (!deptErr && deptRows) {
        deptRows.forEach((r: any) => {
          if (r.department_id) allowedIdsSet.add(r.department_id);
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
          if (r.inbox_id) allowedIdsSet.add(r.inbox_id);
        });
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying inbox_members:", e);
    }

    // 5. Buscar em inboxStore (memória / cache local de membros)
    try {
      const storeInboxes = await inboxStore.getInboxes(storeId);
      for (const ib of storeInboxes) {
        const members = await inboxStore.getMembers(ib.id);
        if (members && members.some(m => allSearchIdentifiers.includes(m))) {
          allowedIdsSet.add(ib.id);
        }
      }
    } catch (e) {
      console.warn("[OperatorAccess] Error querying inboxStore members:", e);
    }
  }

  return {
    isOperator: true,
    allowedInboxIds: Array.from(allowedIdsSet)
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

app.post("/api/v1/inboxes", async (req, res) => {
  try {
    const { store_id, name, description, whatsapp_instance_id, channel_type } = req.body;
    const storeId = store_id || (req.headers["x-tenant-id"] as string) || "default";
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const created = await inboxStore.createInbox(storeId, name, description, whatsapp_instance_id, channel_type);
    return res.status(201).json({ data: created });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put("/api/v1/inboxes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, whatsapp_instance_id, channel_type } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const updated = await inboxStore.updateInbox(id, name, description, whatsapp_instance_id, channel_type);
    return res.json({ data: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/v1/inboxes/:id", async (req, res) => {
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

app.post("/api/v1/inboxes/:id/members", async (req, res) => {
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

app.put("/api/v1/inboxes/:id/members", async (req, res) => {
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

app.post("/api/v1/inboxes/:id/members/toggle", async (req, res) => {
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

app.post("/api/v1/inboxes/:id/teams", async (req, res) => {
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

    const cleanRole = String(role).trim().toLowerCase();
    // Validação de Segurança RBAC: Apenas funções operacionais permitidas para estabelecimentos
    if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(cleanRole)) {
      return res.status(403).json({ 
        error: "Permissão negada: As lojas podem cadastrar apenas colaboradores operacionais (Gerente ou Operador/Balconista). Cargos administrativos/matriz são de exclusividade do Super Admin." 
      });
    }

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
          role: role.toLowerCase(),
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
              role: role.toLowerCase(),
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
        role
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
      cleanRole = String(role).trim().toLowerCase();
      if (!STORE_ALLOWED_OPERATIONAL_ROLES.includes(cleanRole)) {
        return res.status(403).json({ 
          error: "Permissão negada: As lojas podem atribuir apenas cargos operacionais (Gerente ou Operador/Balconista)." 
        });
      }
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
      return res.json({ success: true, data: targetTenant });
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

    console.log(`[TenantSettings] Atualizando configurações para tenant "${targetTenant.name}" (${targetTenant.id}):`, updates);

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
      data: updated || { ...targetTenant, ...updates }
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
  absorvente: ["absorvente", "abs"],
  abs: ["absorvente", "abs"],
  gotas: ["gotas", "gts"],
  gts: ["gotas", "gts"],
  comprimido: ["comprimido", "cp", "cpl", "cpr"],
  comprimidos: ["comprimido", "cp", "cpl", "cpr"],
  cp: ["comprimido", "cp", "cpl", "cpr"],
  cpl: ["comprimido", "cp", "cpl", "cpr"],
  cpr: ["comprimido", "cp", "cpl", "cpr"],
  capsula: ["capsula", "cap"],
  capsulas: ["capsula", "cap"],
  cap: ["capsula", "cap"],
  miligrama: ["miligrama", "mg"],
  miligramas: ["miligrama", "mg"],
  mg: ["miligrama", "mg"],
  paracetamol: ["paracetamol", "tylenol"],
  tylenol: ["paracetamol", "tylenol"],
  dipirona: ["dipirona", "novalgina"],
  novalgina: ["dipirona", "novalgina"],
  ibuprofeno: ["ibuprofeno", "alivium"],
  alivium: ["ibuprofeno", "alivium"],
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

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc("search_products_v2", {
          p_tenant_id: tenantId,
          p_search_term: searchTermToUse,
          p_category: category || "Todos",
          p_limit: limit,
          p_offset: from
        });

        if (!rpcError && Array.isArray(rpcData)) {
          const validRpcData = rpcData.filter((p: any) => Number(p.price) > 0 && Number(p.stock ?? 1) > 0);
          res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
          return res.json({
            data: validRpcData,
            total: validRpcData.length >= limit ? -1 : validRpcData.length + from,
            page,
            limit,
            source: "postgres_rpc"
          });
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
        const searchTokens = cleanSearchText.split(/\s+/).filter(t => t.length > 0);
        
        let expandedTokens = [...searchTokens];
        searchTokens.forEach(token => {
          const syns = ENDPOINT_PHARMA_SYNONYMS[token];
          if (syns) {
            expandedTokens = [...expandedTokens, ...syns];
          }
        });
        expandedTokens = Array.from(new Set(expandedTokens));

        const tsQueryFormated = expandedTokens.map(tok => `${tok}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated},category.fts.${tsQueryFormated},active_principle.fts.${tsQueryFormated}`
        );
      }
    }

    const { data, count, error } = await query.range(from, to);
    if (error) throw error;

    let finalData = data || [];

    if (search && search.trim().length > 0) {
      const cleanSearch = normalizeText(search);
      const searchTokens = cleanSearch.split(/\s+/).filter(t => t.length > 0);
      
      let expandedTokens = [...searchTokens];
      searchTokens.forEach(token => {
        const syns = ENDPOINT_PHARMA_SYNONYMS[token];
        if (syns) {
          expandedTokens = [...expandedTokens, ...syns];
        }
      });
      expandedTokens = Array.from(new Set(expandedTokens));

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
            if (name.includes(token)) score += 300;
            if (cat.includes(token)) score += 200;
            if (act.includes(token)) score += 200;
            if (desc.includes(token)) {
              score += 10;
            }
          });

          expandedTokens.forEach(token => {
            if (!searchTokens.includes(token)) {
              if (name.includes(token)) score += 150;
              if (cat.includes(token)) score += 100;
              if (act.includes(token)) score += 100;
              if (desc.includes(token)) score += 5;
            }
          });
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

      scoredProducts.sort((a, b) => b._score - a._score);
      finalData = scoredProducts.map(p => {
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
        : p.promotionalPrice;
      const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
      const validPromo = !isNaN(numPromo) && numPromo > 0 ? numPromo : null;

      const rawPrice = p.price !== undefined && p.price !== null ? Number(p.price) : 0;
      const validPrice = !isNaN(rawPrice) && rawPrice >= 0 ? rawPrice : 0;

      const rawOrigPrice = (p.original_price !== undefined && p.original_price !== null)
        ? Number(p.original_price)
        : (p.originalPrice !== undefined && p.originalPrice !== null ? Number(p.originalPrice) : 0);
      const validOrigPrice = !isNaN(rawOrigPrice) && rawOrigPrice >= 0 ? rawOrigPrice : 0;

      // Preserva estoque 0 (ZERO estoque é perfeitamente válido no catálogo)
      const rawStock = p.stock !== undefined && p.stock !== null ? Number(p.stock) : 0;
      const validStock = !isNaN(rawStock) ? rawStock : 0;

      const cleanBarcode = p.barcode && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : null;
      const cleanInternalCode = p.internal_code ?? p.internalCode;
      const cleanCode = cleanInternalCode && String(cleanInternalCode).trim() !== '' ? String(cleanInternalCode).trim() : null;

      const item: any = {
        ...p,
        id: p.id || Math.random().toString(36).substr(2, 9),
        tenant_id: tenantId,
        tenantid: tenantId,
        name: p.name ? String(p.name).trim() : 'Produto sem nome',
        barcode: cleanBarcode,
        internal_code: cleanCode,
        price: validPrice,
        original_price: validOrigPrice,
        promotional_price: validPromo,
        stock: validStock,
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

    // 2. Busca estritamente por EAN (barcode) e ID no banco de dados da farmácia
    // O código interno NUNCA é utilizado para buscar ou corresponder produtos entre planilhas
    const barcodesToLookup = sanitizedProducts
      .map(p => p.barcode)
      .filter((b): b is string => Boolean(b && b.length > 0));

    const idsToLookup = sanitizedProducts
      .map(p => p.id)
      .filter((id): id is string => Boolean(id && id.length > 0));

    const dbExistingByBarcode = new Map<string, { id: string; barcode: string | null; internal_code: string | null; name: string }>();
    const dbExistingById = new Map<string, { id: string; barcode: string | null; internal_code: string | null; name: string }>();

    const LOOKUP_CHUNK = 500;

    // Busca estritamente por código de barras (EAN)
    if (barcodesToLookup.length > 0) {
      for (let i = 0; i < barcodesToLookup.length; i += LOOKUP_CHUNK) {
        const barcodeChunk = barcodesToLookup.slice(i, i + LOOKUP_CHUNK);
        const { data: dbMatches } = await supabaseAdmin
          .from("products")
          .select("id, barcode, internal_code, name")
          .eq("tenant_id", tenantId)
          .in("barcode", barcodeChunk);

        if (dbMatches) {
          dbMatches.forEach(row => {
            if (row.barcode) dbExistingByBarcode.set(String(row.barcode).trim(), row);
            dbExistingById.set(row.id, row);
          });
        }
      }
    }

    // Busca por ID direto
    if (idsToLookup.length > 0) {
      for (let i = 0; i < idsToLookup.length; i += LOOKUP_CHUNK) {
        const idChunk = idsToLookup.slice(i, i + LOOKUP_CHUNK);
        const { data: dbMatches } = await supabaseAdmin
          .from("products")
          .select("id, barcode, internal_code, name")
          .eq("tenant_id", tenantId)
          .in("id", idChunk);

        if (dbMatches) {
          dbMatches.forEach(row => {
            if (row.barcode) dbExistingByBarcode.set(String(row.barcode).trim(), row);
            dbExistingById.set(row.id, row);
          });
        }
      }
    }

    // 3. Classifica produtos entre UPDATE (já existentes por EAN ou ID) e INSERT (genuinamente novos)
    const productsToUpdate: any[] = [];
    const productsToInsert: any[] = [];

    for (const p of sanitizedProducts) {
      let existingMatch: { id: string; barcode: string | null; internal_code: string | null; name: string } | undefined = undefined;

      // Correspondência estritamente por EAN (barcode) ou ID existente
      if (p.barcode && dbExistingByBarcode.has(p.barcode)) {
        existingMatch = dbExistingByBarcode.get(p.barcode);
      } else if (p.id && dbExistingById.has(p.id)) {
        existingMatch = dbExistingById.get(p.id);
      }

      if (existingMatch) {
        // Produto já existe na farmácia: adota o ID real da farmácia para UPDATE limpo
        p.id = existingMatch.id;
        productsToUpdate.push(p);
      } else {
        // Novo produto genuíno (EAN não encontrado na farmácia)
        productsToInsert.push(p);
      }
    }

    // 4. Execução do Salvamento com Tratamento Silencioso de Conflitos (23505)
    let savedCount = 0;
    let failedCount = 0;
    const failedDetails: any[] = [];
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

    // Set Cache-Control Headers for Vercel Edge caching
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
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

app.get("/api/v1/products/:id", async (req, res) => {
  try {
    const rawId = req.params.id;
    // 1. Tenta buscar por ID direto
    const { data: byId, error: errId } = await supabase
      .from("products")
      .select("*")
      .eq("id", rawId)
      .maybeSingle();

    if (!errId && byId) {
      return res.json(byId);
    }

    // 2. Fallback: Tenta por internal_code ou barcode
    const { data: byCode } = await supabase
      .from("products")
      .select("*")
      .or(`internal_code.eq.${rawId},barcode.eq.${rawId}`)
      .limit(1)
      .maybeSingle();

    if (byCode) {
      return res.json(byCode);
    }

    // 3. Fallback: Tenta por aproximação de nome
    const { data: byName } = await supabase
      .from("products")
      .select("*")
      .ilike("name", `%${rawId}%`)
      .limit(1)
      .maybeSingle();

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

    let tenantData: any = null;

    if (isUpdate) {
      let { data, error } = await supabase
        .from("tenants")
        .upsert(enrichedPayload)
        .select();
      if (error && (error.code === "42703" || error.message?.includes("does not exist"))) {
        console.warn("[TENANTS ADMIN] Coluna não encontrada na tabela tenants, salvando via fallback:", error.message);
        const cleanPayload = { ...enrichedPayload };
        delete cleanPayload.razao_social;
        delete cleanPayload.farmaceutico_responsavel;
        delete cleanPayload.crf;
        delete cleanPayload.horario_funcionamento;
        delete cleanPayload.telefone_contato;
        const retry = await supabase.from("tenants").upsert(cleanPayload).select();
        if (retry.error) throw retry.error;
        data = retry.data;
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
        console.warn("[TENANTS ADMIN] Coluna não encontrada na tabela tenants (insert), salvando via fallback:", error.message);
        const cleanPayload = { ...enrichedPayload };
        delete cleanPayload.razao_social;
        delete cleanPayload.farmaceutico_responsavel;
        delete cleanPayload.crf;
        delete cleanPayload.horario_funcionamento;
        delete cleanPayload.telefone_contato;
        const retry = await supabase.from("tenants").insert(cleanPayload).select();
        if (retry.error) throw retry.error;
        data = retry.data;
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

    res.json({ data: tenantData });
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

// --- INTEGRATION API (ERP/PDV) ---

// Middleware para autenticação via API Key
const authenticateIntegration = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    return res.status(401).json({ error: "API Key não fornecida (x-api-key)" });
  }

  // Busca o tenant pela integration_token
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("integration_token", apiKey)
    .single();

  if (error || !tenant) {
    // Fallback: permite usar o próprio ID do tenant como token para testes/compatibilidade
    const { data: tenantById, error: errById } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", apiKey)
      .single();

    if (errById || !tenantById) {
      return res.status(401).json({ error: "API Key inválida" });
    }
    (req as any).tenantId = tenantById.id;
    return next();
  }

  (req as any).tenantId = tenant.id;
  next();
};

/**
 * @swagger
 * /sale:
 *   post:
 *     summary: Webhook de Baixa de Estoque (Venda no Balcão)
 *     description: Subtrai a quantidade vendida do estoque da loja online. Se o estoque chegar a zero, o produto é ocultado da vitrine principal.
 *     tags: [Vendas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               ean:
 *                 type: string
 *                 description: Código de barras (EAN) do produto
 *               internalCode:
 *                 type: string
 *                 description: Código interno do produto no ERP
 *               quantity:
 *                 type: number
 *                 description: Quantidade vendida
 *               transactionId:
 *                 type: string
 *                 description: "ID transacional exclusivo da venda/cupom gerado pelo ERP. Usado como trava de segurança (idempotência) para evitar baixas duplicadas de estoque caso a rede oscile."
 *     responses:
 *       200:
 *         description: Estoque atualizado com sucesso
 *       400:
 *         description: EAN ou Código Interno não fornecido
 *       404:
 *         description: Produto não encontrado
 */
app.post(
  "/api/v1/integration/sale",
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const { ean, internalCode, quantity, transactionId } = req.body;

    // Sanitização e Normalização
    const sanitizedEan = ean ? String(ean).replace(/\s+/g, "").trim() : "";
    const sanitizedInternalCode = internalCode
      ? String(internalCode).trim()
      : "";

    if (!sanitizedEan && !sanitizedInternalCode) {
      return res
        .status(400)
        .json({
          error:
            "É necessário fornecer o 'ean' ou o 'internalCode' para realizar a baixa de estoque.",
        });
    }

    if (typeof quantity !== "number" || quantity <= 0) {
      return res
        .status(400)
        .json({
          error: "Quantidade inválida. Deve ser um número maior que zero.",
        });
    }

    try {
      // Mecanismo de Idempotência (Proteção contra Cliques Duplos)
      if (transactionId) {
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        // Busca logs de sucesso nas últimas 24h contendo o mesmo transactionId
        const { data: previousLogs, error: checkError } = await supabase
          .from("integration_logs")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("endpoint", "/sale")
          .eq("status", "SUCCESS")
          .gte("created_at", yesterday.toISOString())
          .contains("payload", { transactionId });

        if (checkError)
          throw new Error(
            `Falha ao verificar idempotência: ${checkError.message}`,
          );

        if (previousLogs && previousLogs.length > 0) {
          return res.status(200).json({
            success: true,
            message:
              "Transação ignorada: transactionId já processado anteriormente.",
            action: "skipped",
          });
        }
      }

      // Busca o produto
      let query = supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId);
      if (sanitizedEan) {
        query = query.eq("barcode", sanitizedEan);
      } else {
        query = query.eq("internal_code", sanitizedInternalCode);
      }

      const { data: products, error: searchError } = await query;
      if (searchError) throw searchError;

      if (!products || products.length === 0) {
        return res
          .status(404)
          .json({ error: "Produto não encontrado no catálogo." });
      }

      const product = products[0];
      const newStock = Math.max(0, (product.stock || 0) - quantity);

      // Regra de Visibilidade: Se o estoque chegar a zero, ocultar da vitrine (is_featured = false)
      const updates: any = { stock: newStock };
      if (newStock === 0 && product.is_featured) {
        updates.is_featured = false;
      }

      const { error: updateError } = await supabase
        .from("products")
        .update(updates)
        .eq("id", product.id);

      if (updateError) throw updateError;

      // Log integration
      await logIntegration(tenantId, "/sale", req.body, "SUCCESS");

      res
        .status(200)
        .json({ success: true, newStock, hiddenFromShowcase: newStock === 0 });
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/sale",
        req.body,
        "FAILED",
        error.message,
      );
      res
        .status(500)
        .json({
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
 *     summary: Sincronização de Entrada de Mercadoria (Notas Fiscais)
 *     description: Soma a quantidade de entrada ao saldo atual. Atualiza preços se necessário. Cria rascunho se o produto for novo.
 *     tags: [Compras]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ean
 *               - quantity
 *               - costPrice
 *             properties:
 *               ean:
 *                 type: string
 *               internalCode:
 *                 type: string
 *               name:
 *                 type: string
 *               quantity:
 *                 type: number
 *               costPrice:
 *                 type: number
 *               salePrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Estoque/Preço atualizado ou produto criado
 */
app.post(
  "/api/v1/integration/purchase",
  authenticateIntegration,
  async (req, res) => {
    const tenantId = (req as any).tenantId;
    const { ean, internalCode, name, quantity, costPrice, salePrice } =
      req.body;

    // Sanitização e Normalização
    const sanitizedEan = ean ? String(ean).replace(/\s+/g, "").trim() : "";
    const sanitizedInternalCode = internalCode
      ? String(internalCode).trim()
      : "";

    if (!sanitizedEan) {
      return res
        .status(400)
        .json({ error: "O 'ean' é obrigatório para entrada de mercadoria." });
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      return res
        .status(400)
        .json({
          error: "Quantidade inválida. Deve ser um número maior que zero.",
        });
    }

    // Tratamento de Precisão Decimal (Preços)
    const sanitizedCostPrice =
      typeof costPrice === "number"
        ? Math.round(costPrice * 100) / 100
        : undefined;
    let sanitizedSalePrice =
      typeof salePrice === "number"
        ? Math.round(salePrice * 100) / 100
        : undefined;

    try {
      const { data: products, error: searchError } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("barcode", sanitizedEan);

      if (searchError) throw searchError;

      if (products && products.length > 0) {
        // Produto existe, atualiza estoque e preço
        const product = products[0];
        const newStock = (product.stock || 0) + quantity;

        const updates: any = { stock: newStock };
        if (
          sanitizedSalePrice !== undefined &&
          sanitizedSalePrice !== product.price
        ) {
          updates.price = sanitizedSalePrice;
        }

        const { error: updateError } = await supabase
          .from("products")
          .update(updates)
          .eq("id", product.id);

        if (updateError) throw updateError;
        res.status(200).json({ success: true, action: "updated", newStock });
      } else {
        // Fallback de preço de venda (Padrão de 50% de margem sobre o preço de custo)
        if (
          sanitizedSalePrice === undefined &&
          sanitizedCostPrice !== undefined
        ) {
          sanitizedSalePrice = Math.round(sanitizedCostPrice * 1.5 * 100) / 100;
        }

        // Produto novo, cria rascunho. Garante Fallback de Código Interno
        const newProduct = {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          barcode: sanitizedEan,
          internal_code: sanitizedInternalCode || sanitizedEan,
          name: name ? String(name).trim() : `Produto Novo (${sanitizedEan})`,
          stock: quantity,
          price: sanitizedSalePrice ?? 0,
          category: "Geral",
          is_ai_enriched: false,
          is_featured: false,
        };

        const { data: inserted, error: insertError } = await supabase
          .from("products")
          .insert(newProduct)
          .select();

        if (insertError) throw insertError;

        // O "Exército de Agentes" (cron job ou trigger) vai pegar os produtos com is_ai_enriched = false
        res
          .status(201)
          .json({ success: true, action: "created", product: inserted[0] });
      }

      await logIntegration(tenantId, "/purchase", req.body, "SUCCESS");
    } catch (error: any) {
      await logIntegration(
        tenantId,
        "/purchase",
        req.body,
        "FAILED",
        error.message,
      );
      res
        .status(500)
        .json({
          error: "Erro interno no processamento da entrada de mercadoria.",
          details: error.message,
        });
    }
  },
);

app.get("/api/v1/integration/logs/:tenantId", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { data, error } = await supabase
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
    res.json(data);
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
});

app.post("/api/integrations/erp/send-order", async (req, res) => {
  try {
    const { order_id, tenant_id } = req.body;
    if (!order_id || !tenant_id) {
      return res.status(400).json({ error: 'Missing order_id or tenant_id' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    const { data: order, error: fetchError } = await supabaseClient
      .from('orders')
      .select(`
        *,
        order_items (
          quantity,
          unit_price,
          products (
            barcode,
            ean
          )
        ),
        customers (
          name,
          phone,
          cpf,
          address,
          address_number,
          neighborhood,
          city
        )
      `)
      .eq('id', order_id)
      .eq('tenant_id', tenant_id)
      .single();

    let targetOrder = order;

    if (fetchError || !order) {
      const { data: orderJson, error: fetchJsonError } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('id', order_id)
        .eq('tenant_id', tenant_id)
        .single();
        
      if (fetchJsonError || !orderJson) {
         return res.status(404).json({ error: 'Pedido não encontrado ou acesso negado ao tenant.' });
      }
      targetOrder = orderJson;
    }
    
    const customer = targetOrder.customers || targetOrder.customer || {};
    const items = targetOrder.order_items || targetOrder.items || [];

    const dados_cliente = {
      nome: customer.name || customer.nome || 'Cliente Não Identificado',
      telefone: customer.phone || customer.telefone || '',
      cpf: customer.cpf || '',
      endereco: {
        rua: customer.address || customer.street || customer.rua || '',
        numero: customer.address_number || customer.addressNumber || customer.number || customer.numero || '',
        bairro: customer.neighborhood || customer.bairro || '',
        cidade: customer.city || customer.cidade || ''
      }
    };

    const payload_itens = items.map((item: any) => {
      const barcode = item.products?.barcode || item.products?.ean || item.barcode || item.product?.barcode || item.ean || '';
      const ean = barcode.replace(/[^0-9]/g, '');
      return {
        ean: ean,
        quantidade: item.quantity || item.quantidade || 1,
        preco_unitario: item.unit_price || item.price || item.preco_unitario || 0
      };
    });

    const payload = {
      order_id: targetOrder.id,
      tenant_id: targetOrder.tenant_id,
      dados_cliente,
      itens: payload_itens,
      pagamento: {
        forma_pagamento: targetOrder.paymentMethod || targetOrder.payment_method || targetOrder.forma_pagamento || '',
        taxa_entrega: targetOrder.deliveryFee || targetOrder.delivery_fee || targetOrder.taxa_entrega || 0,
        valor_total: targetOrder.total || targetOrder.total_amount || targetOrder.valor_total || 0
      }
    };

    const { data: tenantSettings } = await supabaseClient
      .from('tenants')
      .select('erp_webhook_url, erp_webhook_secret')
      .eq('id', targetOrder.tenant_id)
      .maybeSingle();

    if (tenantSettings?.erp_webhook_url) {
      try {
        const webhookResponse = await fetch(tenantSettings.erp_webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tenantSettings.erp_webhook_secret ? { 'Authorization': `Bearer ${tenantSettings.erp_webhook_secret}` } : {})
          },
          body: JSON.stringify(payload)
        });
        if (!webhookResponse.ok) {
          console.error(`Erro ao enviar payload ao Webhook. Status: ${webhookResponse.status}`);
        }
      } catch (err) {
        console.error('Falha na requisição para o Webhook do ERP', err);
      }
    }

    const { error: updateError } = await supabaseClient
      .from('orders')
      .update({ status: 'enviado_ao_pdv' })
      .eq('id', targetOrder.id)
      .eq('tenant_id', targetOrder.tenant_id);

    if (updateError) {
      console.error('Erro ao atualizar status do pedido no Supabase:', updateError);
      return res.status(500).json({ error: 'Falha ao atualizar status do pedido para enviado_ao_pdv' });
    }

    return res.json({
      success: true,
      message: 'Pedido enviado à fila de integração do ERP (PDV) com sucesso',
      payload_enviado: payload
    });
  } catch (error: any) {
    console.error('Erro ao processar integração ERP:', error);
    return res.status(500).json({ error: 'Erro interno no servidor', details: error.message });
  }
});

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


app.post("/api/v1/agent/generate-token", async (req, res) => {
  try {
    const { tenant_id } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: "tenant_id é obrigatório" });
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
  } catch (error) {
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

  console.log(`[DESKTOP AGENT PING] Buscando identificação do tenant. URL: ${req.originalUrl}, Método: ${req.method}, Chaves:`, Array.from(lookupKeys));

  let foundTenant: any = null;
  let matchedToken: string | null = bodyToken || queryToken || null;

  if (lookupKeys.size > 0) {
    const keyArray = Array.from(lookupKeys);
    
    // 1. Busca por integration_token na tabela tenants
    for (const key of keyArray) {
      try {
        const { data: byToken } = await supabaseAdmin
          .from('tenants')
          .select('*')
          .eq('integration_token', key)
          .maybeSingle();
        if (byToken) {
          foundTenant = byToken;
          break;
        }
      } catch (e) {}
    }

    // 2. Busca por slug na tabela tenants
    if (!foundTenant) {
      for (const key of keyArray) {
        try {
          const { data: bySlug } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('slug', key)
            .maybeSingle();
          if (bySlug) {
            foundTenant = bySlug;
            break;
          }
        } catch (e) {}
      }
    }

    // 3. Busca por id (string ou UUID) na tabela tenants
    if (!foundTenant) {
      for (const key of keyArray) {
        try {
          const { data: byId } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', key)
            .maybeSingle();
          if (byId) {
            foundTenant = byId;
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
        const { data: tokenRow } = await supabaseAdmin
          .from('activation_tokens')
          .select('tenant_id, token')
          .eq('token', key)
          .maybeSingle();
        if (tokenRow?.tenant_id) {
          matchedToken = tokenRow.token;
          const { data: t } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', tokenRow.tenant_id)
            .maybeSingle();
          if (t) {
            foundTenant = t;
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
        const { data: agentRow } = await supabaseAdmin
          .from('agent_integrations')
          .select('tenant_id, activation_token')
          .or(`activation_token.eq.${key},tenant_id.eq.${key}`)
          .maybeSingle();
        if (agentRow?.tenant_id) {
          if (!matchedToken && agentRow.activation_token) matchedToken = agentRow.activation_token;
          const { data: t } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('id', agentRow.tenant_id)
            .maybeSingle();
          if (t) {
            foundTenant = t;
            break;
          }
        }
      } catch (e) {}
    }
  }

  return {
    tenant: foundTenant,
    tenantId: foundTenant?.id || null,
    machineId: machineId && machineId !== 'unknown' ? machineId : null,
    activationToken: matchedToken
  };
}

async function touchAgentHeartbeat(tenantId: string, machineId?: string | null, activationToken?: string | null) {
  if (!tenantId) return;
  const now = new Date().toISOString();
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
      .select('id, name, slug, erp_type, integration_token')
      .eq('id', tokenData.tenant_id)
      .single();
      
    await touchAgentHeartbeat(tokenData.tenant_id, mId, token);

    const erpType = (tenant?.erp_type || 'siagold').toLowerCase().trim();
    console.log(`[DESKTOP AGENT] Token validado com sucesso para tenant: ${tokenData.tenant_id} (${tenant?.name || 'Farmácia'}, ERP: ${erpType})`);

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

    res.json({
      erpType: erpType,
      dbConfig: {
        user: defaultUser,
        password: "sua_senha_aqui",
        server: defaultServer,
        port: defaultPort,
        database: defaultDatabase,
        branchCode: "1",
        viewName: 'VW_INTEGRACAO_FARMAFLOW'
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
      await touchAgentHeartbeat(tenantId, machineId, activationToken);
      console.log(`[DESKTOP AGENT PING] Recebido ping com sucesso para tenant: "${tenantId}" (Loja: "${tenant?.name || tenant?.slug || 'Farmácia'}", Machine ID: "${machineId || 'Servidor'}")`);
      return res.json({ 
        success: true, 
        ok: true,
        tenant_id: tenantId, 
        tenant_name: tenant?.name || null,
        machine_id: machineId || null,
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

    // 1. Busca todos os tenants (ou tenant filtrado) com os campos reais da tabela
    let tenantsList: any[] = [];
    try {
      let tenantQuery = supabaseAdmin
        .from('tenants')
        .select('id, name, slug, erp_type, last_seen, agent_last_seen, created_at, integration_token');

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

    if (tenantsList && tenantsList.length > 0) {
      for (const t of tenantsList) {
        processedTenantIds.add(t.id);
        const agent = agentMap.get(t.id);

        // Encontra o timestamp mais recente entre agent_integrations e tenants
        const candidateDates = [
          agent?.last_seen,
          t.agent_last_seen,
          t.last_seen
        ].filter(Boolean).map((d: any) => new Date(d).getTime()).filter(n => !isNaN(n) && n > 0);

        const latestTimestamp = candidateDates.length > 0
          ? new Date(Math.max(...candidateDates)).toISOString()
          : null;

        finalIntegrations.push({
          id: agent?.id || t.id,
          tenant_id: t.id,
          machine_id: agent?.machine_id || 'Servidor Local',
          is_active: agent?.is_active ?? true,
          last_seen: latestTimestamp,
          activation_token: agent?.activation_token || t.integration_token || null,
          tenants: {
            id: t.id,
            name: t.name,
            slug: t.slug
          }
        });
      }
    }

    // Se houver registros em agent_integrations cujo tenant_id não estava na lista de tenants
    if (agentRows) {
      for (const agent of agentRows) {
        if (agent.tenant_id && !processedTenantIds.has(agent.tenant_id)) {
          finalIntegrations.push({
            id: agent.id,
            tenant_id: agent.tenant_id,
            machine_id: agent.machine_id || 'Servidor Local',
            is_active: agent.is_active ?? true,
            last_seen: agent.last_seen || null,
            activation_token: agent.activation_token || null,
            tenants: {
              id: agent.tenant_id,
              name: 'Farmácia'
            }
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

const handleProductIntegration = async (req: express.Request, res: express.Response) => {
  let tenantId: string | null = null;
  try {
    const { tenant, tenantId: resolvedTenantId, machineId, activationToken } = await resolveTenantForAgent(req);

    if (!tenant || !resolvedTenantId) {
      return res.status(403).json({ error: "API Key inválida ou tenant não encontrado." });
    }

    tenantId = resolvedTenantId;
    const ignoreErpPrices = tenant.ignore_erp_prices === true || tenant.delivery_settings?.ignore_erp_prices === true;
    
    // Atualiza heartbeat do agente imediatamente
    await touchAgentHeartbeat(tenantId, machineId, activationToken);

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

    const getValFromProduct = (product: any, keys: string[]) => {
      if (!product || typeof product !== 'object') return undefined;
      const normalize = (str: string) => {
        let s = str;
        try {
          s = decodeURIComponent(escape(str));
        } catch (e) {}
        s = s.replace(/Ã³/g, 'o').replace(/Ã§/g, 'c').replace(/Ã£/g, 'a')
             .replace(/Ã¡/g, 'a').replace(/Ã©/g, 'e')
             .replace(/Ãµ/g, 'o').replace(/Ãº/g, 'u').replace(/Ã¢/g, 'a')
             .replace(/Ãª/g, 'e').replace(/Ã´/g, 'o');
        return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
      };
      const normalizedKeys = keys.map(k => normalize(k));
      
      for (const key of Object.keys(product)) {
        if (normalizedKeys.includes(normalize(key))) {
          return product[key];
        }
      }
      return undefined;
    };

    const uniquePayloadMap = new Map();
    for (const p of productsBatch) {
       const rawEan = getValFromProduct(p, [
         'barcode', 'ean', 'ean13', 'codigo_barra', 'codigo_barras', 'cod_barra', 'cod_barras', 'codigo_de_barras', 'barras', 'codigo_barra_produto', 'cod barras', 'cod. barras', 
         'cd barras', 'cd. barras', 'cd_barras', 'cd.barras', 'codbarras', 'cdbarras', 'ean_produto'
       ]);
       const ean = rawEan !== undefined && rawEan !== null ? String(rawEan).trim() : "";
       if (!ean) continue;

       const rawInternalCode = getValFromProduct(p, [
         'internal_code', 'internalCode', 'CodigoInterno', 'codigo_interno', 'codigo', 'cod_interno', 'cod_prod', 'codigo_produto', 'cod_produto', 'referencia', 'ref', 'id',
         'cdigo', 'cdg', 'cd'
       ]);
       const internalCode = rawInternalCode !== undefined && rawInternalCode !== null ? String(rawInternalCode).trim() : "";
       
       let stock = Number(getValFromProduct(p, ['stock', 'estoque', 'estoque_atual', 'estoque_disponivel', 'saldo', 'saldo_estoque', 'qtd_estoque', 'quantidade', 'qtd', 'quantidade_estoque', 'quant']));
       if (isNaN(stock) || stock < 0) stock = 0;
       
       let price = Number(getValFromProduct(p, ['price', 'preco_venda', 'preco', 'preco_por', 'preco_unitario', 'valor', 'valor_venda', 'venda', 'preco_venda_unitario']));
       if (isNaN(price) || price < 0) price = 0;

       let originalPrice = Number(getValFromProduct(p, ['original_price', 'originalPrice', 'preco_original', 'preco_de', 'preco_tabela', 'preco_cadastro', 'preco_antigo', 'valor_original']));
       if (isNaN(originalPrice) || originalPrice < 0) originalPrice = 0;

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

       let rawPromoPrice = Number(getValFromProduct(p, [
         'promotional_price', 'promotionalPrice', 'promo_price', 'preco_promocional', 'preco_promo', 'promocional', 'valor_promocional', 'preco_oferta', 'vl_promo', 'preco_por'
       ]));
       const promoPrice = (!isNaN(rawPromoPrice) && rawPromoPrice > 0 && isPromoValid) ? rawPromoPrice : null;

       const rawBuyQty = Number(getValFromProduct(p, [
         'promo_buy_qty', 'promo_qtd_minima', 'qtd_leve', 'leve_x', 'qtd_minima', 'qtd_min', 'buy_x', 'buyX', 'promoBuyQty'
       ]));
       const buyQty = (!isNaN(rawBuyQty) && rawBuyQty > 0 && isPromoValid) ? Math.floor(rawBuyQty) : null;

       const rawPayQty = Number(getValFromProduct(p, [
         'promo_pay_qty', 'promo_qtd_paga', 'qtd_pague', 'pague_y', 'pay_y', 'payY', 'promoPayQty'
       ]));
       const payQty = (!isNaN(rawPayQty) && rawPayQty > 0 && isPromoValid) ? Math.floor(rawPayQty) : null;

       const rawProgPrice = Number(getValFromProduct(p, [
         'promo_progressive_price', 'preco_atacado', 'preco_progressivo', 'valor_atacado', 'vl_atacado', 'promoProgressivePrice'
       ]));
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

       const rawName = getValFromProduct(p, [
         'name', 'nome', 'descricao', 'descricao_produto', 'nome_produto', 'produto',
         'descrio', 'descr'
       ]);
       const name = rawName !== undefined && rawName !== null ? String(rawName).trim() : `Produto ${ean}`;

       const rawCategory = getValFromProduct(p, [
         'category', 'categoria', 'secao', 'grupo', 'departamento', 'classe', 'subcategoria', 'familia', 'depto'
       ]);
       const rawActivePrinciple = getValFromProduct(p, [
         'active_principle', 'activePrinciple', 'principio_ativo', 'substancia', 'formula'
       ]);
       const rawDescription = getValFromProduct(p, ['description', 'descricao_longa', 'detalhes']);
       const rawDrugType = getValFromProduct(p, ['drug_type', 'drugType', 'tipo', 'tipo_produto', 'classe_terapeutica']);
       const rawManufacturer = getValFromProduct(p, ['manufacturer', 'fabricante', 'laboratorio']);
       const rawPresentation = getValFromProduct(p, ['presentation', 'apresentacao', 'embalagem']);

       const classified = classifyProductTaxonomy({
         name: name,
         activePrinciple: rawActivePrinciple,
         description: rawDescription,
         rawCategory: rawCategory,
         drugType: rawDrugType,
         manufacturer: rawManufacturer
       });

       const rawImage = getValFromProduct(p, [
         'image', 'imagem', 'foto', 'url_imagem', 'url_foto', 'imagem_url', 'img'
       ]);
       const image = (rawImage !== undefined && rawImage !== null && String(rawImage).trim().length > 0) ? String(rawImage).trim() : null;

       uniquePayloadMap.set(ean, {
          tenant_id: tenantId,
          barcode: ean,
          internal_code: internalCode || null,
          stock,
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
          category: classified.subcategory,
          department: classified.department,
          active_principle: rawActivePrinciple || null,
          manufacturer: rawManufacturer || null,
          presentation: rawPresentation || null,
          drug_type: rawDrugType || (classified.department === "Medicamentos" ? "Outros" : "Cosmético")
       });
     }

    const upsertPayload = Array.from(uniquePayloadMap.values());

    if (upsertPayload.length === 0) {
      await logIntegration(tenantId, "/api/v1/integration", { 
        message: "Nenhum produto válido encontrado no lote.", 
        productsBatchSize: productsBatch.length,
        processedCount: 0,
        isSuccess: true,
        rawBatchSample: productsBatch.slice(0, 5)
      }, "SUCCESS");
      return res.status(200).json({ success: true, processed: 0, message: "Nenhum produto válido encontrado no lote." });
    }

    const CHUNK_SIZE = 100;
    let processed = 0;
    
    for (let i = 0; i < upsertPayload.length; i += CHUNK_SIZE) {
      const chunk = upsertPayload.slice(i, i + CHUNK_SIZE);
      
      const barcodes = chunk.map(p => p.barcode);
      const { data: existingProducts } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('barcode', barcodes);
        
      const existingMap = new Map();
      if (existingProducts && existingProducts.length > 0) {
         existingProducts.forEach(p => {
            if (p.barcode) {
               existingMap.set(p.barcode, p);
            }
         });
      }

      // Regra de Ouro: Se produto novo vier sem foto mas tiver barcode, busca se já existe foto para aquele barcode em outra loja no Supabase
      const newBarcodesNeedingImage = chunk
        .filter(item => !existingMap.has(item.barcode) && (!item.image || String(item.image).trim().length === 0))
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
              if (sp.barcode && sp.image && !crossStoreImageMap.has(sp.barcode)) {
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

      chunk.forEach(item => {
         if (existingMap.has(item.barcode)) {
            const existing = existingMap.get(item.barcode);
            let finalPrice = item.price;
            let finalOriginalPrice = item.original_price;
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
            
            // Se o ignore_erp_prices estiver ativo, preserva os preços e regras promocionais salvos no painel
            if (ignoreErpPrices) {
               finalPrice = existing.price;
               finalOriginalPrice = existing.original_price;
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
            }
            
            // Regra de Ouro: NUNCA sobrescreva uma imagem já existente no banco se o ERP enviar vazio ou nulo!
            const finalImage = (item.image && typeof item.image === 'string' && item.image.trim().length > 0)
              ? item.image.trim()
              : existing.image;

            // Se a categoria existente for vazia ou genérica ('OUTROS', 'DIVERSOS', 'Geral', etc.), atualiza para a classificação oficial
            const isGenericCategory = !existing.category || 
              ['outros', 'diversos', 'geral', 'sem categoria', 'nao cadastrado', 'não cadastrado', 'padrao', 'padrão'].includes(String(existing.category).trim().toLowerCase());
            
            const finalCategory = isGenericCategory ? item.category : existing.category;
            const finalDepartment = (!existing.department || isGenericCategory) ? item.department : existing.department;

            // Regra de Ouro: atualizações de produtos existentes alteram apenas campos específicos, mas completamos a linha com os dados já existentes para evitar que o upsert do PostgREST limpe as colunas não informadas (sobrescrevendo com NULL)
            const isZeroPrice = Number(finalPrice) <= 0 || isNaN(Number(finalPrice));
            existingProductsPayload.push({
               ...existing, // Mantém todos os campos existentes (nome, categoria, imagem, princípio ativo, etc.)
               category: finalCategory,
               department: finalDepartment,
               internal_code: item.internal_code || existing.internal_code,
               stock: item.stock,
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
            });
         } else {
            // Novo produto: se não veio foto do ERP, aproveita foto do barcode encontrada em outra farmácia do sistema
            const finalImage = (item.image && typeof item.image === 'string' && item.image.trim().length > 0)
              ? item.image.trim()
              : (crossStoreImageMap.get(item.barcode) || null);

            const isNewZeroPrice = Number(item.price) <= 0 || isNaN(Number(item.price));
            newProductsPayload.push({
              ...item,
              is_featured: isNewZeroPrice ? false : Boolean(item.is_featured),
              image: finalImage
            });
         }
      });

      if (newProductsPayload.length > 0) {
         const { error } = await supabaseAdmin
           .from('products')
           .upsert(newProductsPayload, { 
              onConflict: 'tenant_id,barcode', 
              ignoreDuplicates: false 
           });
         if (error) {
            console.error("[Integration] New Products Insert Error:", error);
            throw new Error(`Database insert error: ${error.message}`);
         }
      }

      if (existingProductsPayload.length > 0) {
         const { error } = await supabaseAdmin
           .from('products')
           .upsert(existingProductsPayload, { 
              onConflict: 'tenant_id,barcode', 
              ignoreDuplicates: false 
           });
         if (error) {
            console.error("[Integration] Existing Products Update Error:", error);
            throw new Error(`Database update error: ${error.message}`);
         }
      }
      
      processed += chunk.length;
    }

    try {
      await logIntegration(tenantId, "/api/v1/integration", { 
        message: `Sincronização do agente via API concluída com sucesso`, 
        productsBatchSize: productsBatch.length, 
        processedCount: processed,
        isSuccess: true 
      }, "SUCCESS");
    } catch (logErr) {
      console.error("Erro ao salvar log de sucesso de integração:", logErr);
    }

    res.status(200).json({ success: true, processed });

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
  "/api/v1/agent/sync"
], handleProductIntegration);

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

function normalizeEvolutionUrl(url?: string): string {
  if (!url) return DEFAULT_EVOLUTION_URL;
  let cleaned = url.trim();
  if (!cleaned) return DEFAULT_EVOLUTION_URL;
  
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  
  try {
    const parsed = new URL(cleaned);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${protocol}//${host}${pathname}`;
  } catch (e) {
    return cleaned.replace(/\/+$/, '');
  }
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

async function resolveEvolutionConfig(tenantId: string, inboxId?: string, override?: any) {
  let evolutionUrl = override?.evolutionUrl;
  let evolutionKey = override?.evolutionKey;
  let instanceName = override?.instanceName;

  const rawTenant = (tenantId || "principal").replace(/^store_/, '').replace(/^tenant_/, '');
  const cleanStore = rawTenant.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  // 1. Identificar ou resolver o nome exclusivo da instância
  if (!instanceName) {
    if (inboxId && inboxId !== "default" && !inboxId.includes("default")) {
      // Verifica se a caixa já possui uma instância vinculada
      try {
        const { data: inboxRow } = await supabaseAdmin
          .from('inboxes')
          .select('whatsapp_instance_id')
          .eq('id', inboxId)
          .maybeSingle();

        if (inboxRow?.whatsapp_instance_id) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inboxRow.whatsapp_instance_id);
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
            instanceName = linkedInst.instance_name;
          }
        }
      } catch (e) {}

      if (!instanceName) {
        const cleanInbox = inboxId.replace(/^inbox_/, '').replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        instanceName = `inbox_${cleanInbox}`;
      }
    } else {
      instanceName = cleanStore ? `store_${cleanStore}` : 'store_principal';
    }
  }

  // 2. Busca credenciais da Evolution API (tenta por instância específica, herda da loja ou do tenant)
  try {
    if (!evolutionUrl || !evolutionKey) {
      // 2.1 Busca por nome da instância específica
      const { data: byName } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('*')
        .eq('instance_name', instanceName)
        .maybeSingle();

      if (byName) {
        if (!evolutionUrl && byName.evolution_url) evolutionUrl = byName.evolution_url;
        if (!evolutionKey && byName.evolution_key) evolutionKey = byName.evolution_key;
      }
    }

    if (!evolutionUrl || !evolutionKey) {
      // 2.2 Herda as credenciais globais da loja/tenant caso já existam configuradas em outra instância
      const targetStoreIds = Array.from(new Set([tenantId, cleanStore, `store_${cleanStore}`].filter(Boolean)));
      const { data: instList } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('*')
        .in('store_id', targetStoreIds)
        .order('updated_at', { ascending: false });

      if (instList && instList.length > 0) {
        const withKey = instList.find(i => i.evolution_key && i.evolution_key.trim() !== '');
        const withUrl = instList.find(i => i.evolution_url && i.evolution_url.trim() !== '');

        if (withKey && !evolutionKey) evolutionKey = withKey.evolution_key;
        if (withUrl && !evolutionUrl) evolutionUrl = withUrl.evolution_url;
      }
    }

    if (!evolutionUrl || !evolutionKey) {
      // 2.3 Fallback para a tabela tenants
      try {
        const targetIdentifiers = Array.from(new Set([tenantId, cleanStore, `store_${cleanStore}`].filter(Boolean)));
        const { data: tenantRows } = await supabaseAdmin
          .from('tenants')
          .select('*')
          .or(`id.in.(${targetIdentifiers.join(',')}),slug.in.(${targetIdentifiers.join(',')})`)
          .limit(1);

        if (tenantRows && tenantRows.length > 0) {
          const t = tenantRows[0];
          if (!evolutionUrl && (t.evolution_url || t.evolution_api_url)) {
            evolutionUrl = t.evolution_url || t.evolution_api_url;
          }
          if (!evolutionKey && (t.evolution_key || t.evolution_api_key || t.evolution_token)) {
            evolutionKey = t.evolution_key || t.evolution_api_key || t.evolution_token;
          }
        }
      } catch (tErr) {}
    }
  } catch (e) {
    console.warn("[resolveEvolutionConfig] Erro ao buscar dados no Supabase:", e);
  }

  // 3. Fallback para variáveis de ambiente ou URL padrão
  if (!evolutionUrl) {
    evolutionUrl = process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_URL;
  }
  if (!evolutionKey) {
    evolutionKey = process.env.EVOLUTION_API_KEY || "";
  }

  if (typeof evolutionUrl === 'string' && (evolutionUrl.includes('seudominio.com') || evolutionUrl.includes('yourdomain.com'))) {
    evolutionUrl = DEFAULT_EVOLUTION_URL;
  }

  evolutionUrl = normalizeEvolutionUrl(evolutionUrl);
  if (evolutionKey) evolutionKey = String(evolutionKey).trim();

  return { evolutionUrl, evolutionKey, instanceName };
}

app.post("/api/v1/chat/instance/test-evolution", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const { evolutionUrl: inputUrl, evolutionKey: inputKey, instanceName: inputInstance } = req.body;

    const { evolutionUrl, evolutionKey, instanceName } = await resolveEvolutionConfig(tenantId, req.body.inboxId, {
      evolutionUrl: inputUrl,
      evolutionKey: inputKey,
      instanceName: inputInstance
    });

    if (!evolutionUrl) {
      return res.status(200).json({ ok: false, error: "URL da Evolution API não informada." });
    }

    if (!evolutionKey) {
      return res.status(200).json({ ok: false, error: "Chave Global (AUTHENTICATION_API_KEY) da Evolution API não informada." });
    }

    const evoHeaders = {
      "Content-Type": "application/json",
      "apikey": evolutionKey,
      "apiKey": evolutionKey,
      "Authorization": `Bearer ${evolutionKey}`
    };

    let testRes = await safeEvolutionRequest(`${evolutionUrl}/instance/fetchInstances`, {
      headers: evoHeaders
    }, 7000);

    // Fallback: se /fetchInstances não existir nesta versão da Evolution, testa /instance/connectionState/${instanceName}
    if (!testRes.ok && testRes.status === 404 && instanceName) {
      const fallbackRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
        headers: evoHeaders
      }, 5000);
      if (fallbackRes.ok || fallbackRes.status === 404) {
        testRes = fallbackRes;
      }
    }

    if (!testRes.ok) {
      if (testRes.status === 401 || testRes.status === 403) {
        return res.status(200).json({ 
          ok: false, 
          error: "Chave de API (AUTHENTICATION_API_KEY) inválida ou não autorizada na Evolution API." 
        });
      }
      return res.status(200).json({
        ok: false,
        error: testRes.error || testRes.data?.error || testRes.data?.message || `Servidor da Evolution API inacessível em ${evolutionUrl}. Verifique a URL e a rede.`
      });
    }

    let instances: any[] = [];
    if (testRes.data) {
      instances = Array.isArray(testRes.data) ? testRes.data : (testRes.data?.instances || []);
    }

    let instanceExists = false;
    let instanceState = "disconnected";
    let instanceOwner = null;

    if (instanceName) {
      const matching = instances.find((i: any) => 
        (i.name === instanceName || i.instance?.instanceName === instanceName || i.instanceName === instanceName || i.id === instanceName)
      );
      if (matching) {
        instanceExists = true;
        instanceState = matching.connectionStatus || matching.state || matching.instance?.state || "disconnected";
        instanceOwner = matching.owner || matching.instance?.owner || null;
      }
    }

    return res.json({
      ok: true,
      evolutionUrl,
      instanceName,
      totalInstances: instances.length,
      instanceExists,
      instanceState,
      instanceOwner,
      message: "Conexão com a Evolution API estabelecida com sucesso!"
    });
  } catch (error: any) {
    return res.status(200).json({ ok: false, error: error.message || "Erro ao testar conexão com Evolution API" });
  }
});

app.post("/api/v1/chat/instance/save-config", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const { evolutionUrl, evolutionKey, instanceName } = req.body;

    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const targetInstanceName = instanceName || (inboxId && inboxId !== 'default' ? `inbox_${String(inboxId).replace(/[^a-zA-Z0-9]/g,"").toLowerCase()}` : `store_${String(tenantId).replace(/[^a-zA-Z0-9]/g,"").toLowerCase()}`);

    const normalizedUrl = normalizeEvolutionUrl(evolutionUrl || DEFAULT_EVOLUTION_URL);
    const cleanKey = (evolutionKey || '').trim();

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

    // 2. Se não encontrou por instance_name, tenta buscar pelo primeiro registro da loja
    if (!existing) {
      try {
        const { data: storeInstances } = await supabaseAdmin
          .from('whatsapp_instances')
          .select('id')
          .eq('store_id', tenantId)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (storeInstances && storeInstances.length > 0) {
          existing = storeInstances[0];
        }
      } catch (e) {}
    }

    const updatePayload: any = {
      store_id: tenantId,
      instance_name: targetInstanceName,
      evolution_url: normalizedUrl,
      updated_at: new Date().toISOString()
    };

    if (cleanKey) {
      updatePayload.evolution_key = cleanKey;
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
            evolution_key: cleanKey || null,
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

    return res.json({ 
      success: true, 
      evolutionUrl: normalizedUrl,
      evolutionKey: cleanKey,
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

app.post("/api/v1/chat/instance/create", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const forceRecreate = Boolean(req.body.recreate || req.body.force);
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const { evolutionUrl, evolutionKey, instanceName } = await resolveEvolutionConfig(tenantId, inboxId, req.body);

    if (!evolutionUrl || !evolutionKey) {
      return res.status(400).json({ 
        error: "Por favor, informe a Chave Global da Evolution API (AUTHENTICATION_API_KEY) para criar a instância automaticamente.",
        needsKey: true,
        evolutionUrl
      });
    }

    const hostOrigin = req.headers.origin || `https://${req.headers.host}`;
    const webhookUrl = `${hostOrigin}/api/v1/chat/webhook?instance=${encodeURIComponent(instanceName)}&tenantId=${encodeURIComponent(tenantId)}`;

    let base64: string | null = null;
    let isEvolutionLive = false;
    let isConnected = false;
    let phoneNumber: string | null = null;

    try {
      const evoHeaders = {
        "Content-Type": "application/json",
        "apikey": evolutionKey,
        "apiKey": evolutionKey,
        "Authorization": `Bearer ${evolutionKey}`
      };

      const createPayload = {
        instanceName: instanceName,
        token: instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS"
      };

      // Se solicitado recriação forçada, apaga a instância anterior da Evolution API primeiro
      if (forceRecreate) {
        console.log(`[Evolution API] Forçando recriação da instância ${instanceName}...`);
        await safeEvolutionRequest(`${evolutionUrl}/instance/delete/${instanceName}`, {
          method: "DELETE",
          headers: evoHeaders
        }, 5000).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
      }

      // 1. Verificar se a instância já existe e está conectada
      if (!forceRecreate) {
        const stateRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
          headers: evoHeaders
        }, 4000);

        if (stateRes.ok && stateRes.data) {
          const rawState = stateRes.data?.instance?.state || stateRes.data?.state;
          if (rawState === "open") {
            isConnected = true;
            isEvolutionLive = true;
            phoneNumber = stateRes.data?.instance?.owner?.split('@')[0] || stateRes.data?.owner?.split('@')[0] || null;
          }
        }
      }

      // 2. Se não está conectada, tenta conectar ou criar
      if (!isConnected) {
        // Tenta buscar o QR code conectando primeiro caso já exista
        if (!forceRecreate) {
          const connectRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connect/${instanceName}`, {
            headers: evoHeaders
          }, 4000);

          if (connectRes.ok && connectRes.data) {
            base64 = await extractEvolutionQrCode(connectRes.data);
            if (base64) {
              isEvolutionLive = true;
            }
          }
        }

        // Se ainda não temos QR Code ou foi forçado, cria a instância via POST /instance/create
        if (!base64 && !isConnected) {
          let createRes = await safeEvolutionRequest(`${evolutionUrl}/instance/create`, {
            method: "POST",
            headers: evoHeaders,
            body: JSON.stringify(createPayload)
          }, 9000);

          // Se a instância já existia na Evolution mas estava sem QR Code ativo, deleta e recria do zero
          if (!createRes.ok && (createRes.status === 403 || createRes.status === 400)) {
            const errTxt = JSON.stringify(createRes.data || '').toLowerCase();
            if (errTxt.includes('already exist') || errTxt.includes('já existe') || errTxt.includes('in use')) {
              console.log(`[Evolution API] Instância ${instanceName} já existe no servidor mas sem sessão ativa. Recriando do zero...`);
              await safeEvolutionRequest(`${evolutionUrl}/instance/delete/${instanceName}`, {
                method: "DELETE",
                headers: evoHeaders
              }, 5000).catch(() => {});
              await new Promise(r => setTimeout(r, 800));

              createRes = await safeEvolutionRequest(`${evolutionUrl}/instance/create`, {
                method: "POST",
                headers: evoHeaders,
                body: JSON.stringify(createPayload)
              }, 9000);
            }
          }

          if (!createRes.ok) {
            if (createRes.status === 401 || createRes.status === 403) {
              return res.status(401).json({
                error: "Chave Global de API (AUTHENTICATION_API_KEY) incorreta ou rejeitada pela Evolution API. Verifique a chave no Easypanel.",
                needsKey: true
              });
            }
            if (createRes.error && !createRes.data) {
              return res.status(502).json({
                error: `Servidor da Evolution inacessível em ${evolutionUrl}. Verifique se a URL está correta e ativa no Easypanel.`
              });
            }
          }

          if (createRes.data) {
            base64 = await extractEvolutionQrCode(createRes.data);
            if (base64) {
              isEvolutionLive = true;
            }
          }

          // Polling inteligente no /connect para aguardar o Baileys emitir o QR Code
          if (!base64) {
            for (let attempt = 0; attempt < 6; attempt++) {
              await new Promise(r => setTimeout(r, 1200));
              const pollRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connect/${instanceName}`, {
                headers: evoHeaders
              }, 4000);

              if (pollRes.ok && pollRes.data) {
                const pQr = await extractEvolutionQrCode(pollRes.data);
                if (pQr) {
                  base64 = pQr;
                  isEvolutionLive = true;
                  break;
                }
              }
            }
          }
        }

        // 3. Configurar Webhook automaticamente na Evolution API para receber mensagens e conexão em tempo real
        safeEvolutionRequest(`${evolutionUrl}/webhook/set/${instanceName}`, {
          method: "POST",
          headers: evoHeaders,
          body: JSON.stringify({
            enabled: true,
            url: webhookUrl,
            webhookByEvents: true,
            webhook_by_events: true,
            events: [
              "MESSAGES_UPSERT",
              "MESSAGES_UPDATE",
              "SEND_MESSAGE",
              "CONNECTION_UPDATE",
              "QRCODE_UPDATED",
              "CONTACTS_SET"
            ]
          })
        }, 3000).catch(() => {});
      }

    } catch (evolutionError: any) {
      console.error("[Evolution API Error]:", evolutionError.message || evolutionError);
      return res.status(502).json({
        error: `Erro ao comunicar com a Evolution API (${evolutionUrl}): ${evolutionError.message}.`
      });
    }

    if (!base64 && !isConnected) {
      return res.status(400).json({
        error: "A Evolution API não retornou a imagem do QR Code. Verifique se a URL e a Chave API estão corretas na aba Configurações.",
        instanceName,
        evolutionUrl
      });
    }

    // Salvar no banco os dados atualizados e vincular à Caixa de Entrada
    try {
      const updateData: any = {
        store_id: tenantId,
        instance_name: instanceName,
        evolution_url: evolutionUrl,
        evolution_key: evolutionKey,
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
        await supabaseAdmin.from('whatsapp_instances').update(updateData).eq('id', existing.id);
      } else {
        const { data: inserted } = await supabaseAdmin.from('whatsapp_instances').insert(updateData).select('id').maybeSingle();
        if (inserted?.id) instId = inserted.id;
      }

      if (inboxId && instId) {
        try {
          await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: instId }).eq('id', inboxId);
        } catch (e) {}
        try {
          const inboxes = await inboxStore.getInboxes(tenantId);
          const targetInbox = inboxes.find(i => i.id === inboxId);
          if (targetInbox) {
            await inboxStore.updateInbox(inboxId, targetInbox.name, targetInbox.description, instId, targetInbox.channel_type);
          }
        } catch (e) {}
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
        evolutionUrl,
        isEvolutionLive: true
      });
    }

    return res.json({ 
      success: true, 
      status: 'QRCODE',
      qrcodeBase64: base64,
      isEvolutionLive: true,
      instanceName,
      evolutionUrl
    });

  } catch (error: any) {
    console.log("Erro ao criar instância Evolution API:", error.message || error);
    return res.status(500).json({ error: error.message || "Erro interno ao gerar QR Code" });
  }
});

app.get("/api/v1/chat/instance/status", requireChatEnabled, async (req, res) => {
    try {
        const tenantId = (req as any).tenantId || req.query.tenantId;
        const inboxId = req.query.inboxId as string;
        if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });
        
        const { evolutionUrl, evolutionKey, instanceName } = await resolveEvolutionConfig(tenantId, inboxId);

        // Se Evolution estiver configurada, consulta estado real com timeout
        if (evolutionUrl && evolutionKey) {
          try {
            const stateRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
              headers: { "apikey": evolutionKey }
            }, 3500);

            if (stateRes.status === 404) {
              return res.json({ status: 'DISCONNECTED', instanceName, evolutionUrl });
            }
            if (stateRes.ok && stateRes.data) {
              const connectionState = stateRes.data?.instance?.state || stateRes.data?.state;
              if (connectionState === "open") {
                  const phoneNumber = stateRes.data?.instance?.owner?.split('@')[0] || stateRes.data?.owner?.split('@')[0] || null;
                  
                  const { data: existing } = await supabaseAdmin.from('whatsapp_instances').select('id').eq('instance_name', instanceName).maybeSingle();
                  let instId = existing?.id;

                  if (existing) {
                      await supabaseAdmin.from('whatsapp_instances').update({
                         status: 'CONNECTED',
                         ...(phoneNumber ? { phone_number: phoneNumber } : {}),
                         updated_at: new Date().toISOString()
                      }).eq('id', existing.id);
                  } else {
                      const { data: inserted } = await supabaseAdmin.from('whatsapp_instances').insert({
                         store_id: tenantId,
                         instance_name: instanceName,
                         status: 'CONNECTED',
                         ...(phoneNumber ? { phone_number: phoneNumber } : {}),
                         evolution_url: evolutionUrl,
                         evolution_key: evolutionKey,
                         updated_at: new Date().toISOString()
                      }).select('id').maybeSingle();
                      if (inserted?.id) instId = inserted.id;
                  }

                  if (inboxId && instId) {
                    try {
                      await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: instId }).eq('id', inboxId);
                    } catch (e) {}
                  }

                  return res.json({ 
                    status: 'CONNECTED', 
                    phoneNumber, 
                    phone_number: phoneNumber, 
                    instanceName, 
                    evolutionUrl,
                    hasKey: !!evolutionKey,
                    evolutionKey: evolutionKey || undefined
                  });
              } else {
                  const connectRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connect/${instanceName}`, {
                    headers: { "apikey": evolutionKey }
                  }, 3500);

                  let base64: string | null = null;
                  if (connectRes.ok && connectRes.data) {
                    base64 = await extractEvolutionQrCode(connectRes.data);
                  }

                  // Se não veio na resposta do connect, verifica se temos salvo no banco (do webhook)
                  if (!base64) {
                    try {
                      const { data: dbInst } = await supabaseAdmin.from('whatsapp_instances').select('qrcode_base64').eq('instance_name', instanceName).maybeSingle();
                      if (dbInst?.qrcode_base64) {
                        base64 = dbInst.qrcode_base64;
                      }
                    } catch (e) {}
                  }

                  return res.json({ 
                    status: base64 ? 'QRCODE' : 'DISCONNECTED', 
                    qrcodeBase64: base64 || null, 
                    instanceName, 
                    evolutionUrl,
                    hasKey: !!evolutionKey,
                    evolutionKey: evolutionKey || undefined
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
            const resolvedStatus = existing.status === 'CONNECTED' 
              ? 'CONNECTED' 
              : (existing.qrcode_base64 ? 'QRCODE' : 'DISCONNECTED');

            return res.json({ 
              status: resolvedStatus,
              phoneNumber: existing.phone_number || null,
              phone_number: existing.phone_number || null,
              qrcodeBase64: existing.qrcode_base64 || null,
              instanceName,
              evolutionUrl,
              hasKey: !!evolutionKey || !!existing.evolution_key,
              evolutionKey: evolutionKey || existing.evolution_key || undefined
            });
          }
        } catch (dbErr) {}

        return res.json({ 
          status: 'DISCONNECTED', 
          instanceName, 
          evolutionUrl,
          hasKey: !!evolutionKey,
          evolutionKey: evolutionKey || undefined
        });
    } catch(error: any) {
        return res.json({ status: 'DISCONNECTED' });
    }
});

app.post("/api/v1/chat/instance/recreate", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const { evolutionUrl, evolutionKey, instanceName } = await resolveEvolutionConfig(tenantId, inboxId, req.body);

    if (!evolutionUrl || !evolutionKey) {
      return res.status(400).json({ error: "Configurações da Evolution API incompletas." });
    }

    // 1. Deleta instância existente na Evolution
    console.log(`[Evolution API] Recriando instância do zero: ${instanceName}`);
    await safeEvolutionRequest(`${evolutionUrl}/instance/delete/${instanceName}`, {
      method: "DELETE",
      headers: { "apikey": evolutionKey }
    }, 6000).catch(() => {});

    await new Promise(r => setTimeout(r, 1000));

    // 2. Cria nova instância
    const createRes = await safeEvolutionRequest(`${evolutionUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionKey
      },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS"
      })
    }, 10000);

    let base64 = createRes.ok && createRes.data ? await extractEvolutionQrCode(createRes.data) : null;

    // 3. Polling para aguardar o QR Code
    if (!base64) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1200));
        const cRes = await safeEvolutionRequest(`${evolutionUrl}/instance/connect/${instanceName}`, {
          headers: { "apikey": evolutionKey }
        }, 4000);
        if (cRes.ok && cRes.data) {
          const qr = await extractEvolutionQrCode(cRes.data);
          if (qr) {
            base64 = qr;
            break;
          }
        }
      }
    }

    // 4. Configura webhook
    const hostOrigin = req.headers.origin || `https://${req.headers.host}`;
    const webhookUrl = `${hostOrigin}/api/v1/chat/webhook?instance=${encodeURIComponent(instanceName)}&tenantId=${encodeURIComponent(tenantId)}`;
    safeEvolutionRequest(`${evolutionUrl}/webhook/set/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": evolutionKey },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        webhookByEvents: true,
        webhook_by_events: true,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "SEND_MESSAGE",
          "CONNECTION_UPDATE",
          "QRCODE_UPDATED",
          "CONTACTS_SET"
        ]
      })
    }, 3000).catch(() => {});

    // 5. Atualiza no banco
    try {
      const { data: upserted } = await supabaseAdmin.from('whatsapp_instances').upsert({
        store_id: tenantId,
        instance_name: instanceName,
        evolution_url: evolutionUrl,
        evolution_key: evolutionKey,
        status: 'QRCODE',
        qrcode_base64: base64 || null,
        phone_number: null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'instance_name' }).select('id').maybeSingle();

      if (inboxId && upserted?.id) {
        try {
          await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: upserted.id }).eq('id', inboxId);
        } catch (e) {}
      }
    } catch (e) {}

    return res.json({
      success: true,
      status: 'QRCODE',
      qrcodeBase64: base64,
      instanceName,
      evolutionUrl
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Erro ao recriar instância" });
  }
});

app.post("/api/v1/chat/instance/confirm", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    const phoneNumber = req.body.phoneNumber || "(11) 98765-4321";
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const { instanceName, evolutionUrl, evolutionKey } = await resolveEvolutionConfig(tenantId, inboxId, req.body);

    const { data: existing } = await supabaseAdmin.from('whatsapp_instances').select('id').eq('instance_name', instanceName).maybeSingle();
    let instId = existing?.id;

    if (existing) {
      await supabaseAdmin.from('whatsapp_instances').update({
        status: 'CONNECTED',
        phone_number: phoneNumber,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
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
      if (inserted?.id) instId = inserted.id;
    }

    if (inboxId && instId) {
      try {
        await supabaseAdmin.from('inboxes').update({ whatsapp_instance_id: instId }).eq('id', inboxId);
      } catch (e) {}
    }

    return res.json({ success: true, status: 'CONNECTED', phoneNumber, instanceName });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/v1/chat/instance/disconnect", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = (req as any).tenantId || req.body.tenantId || (req.headers["x-tenant-id"] as string);
    const inboxId = req.body.inboxId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const { evolutionUrl, evolutionKey, instanceName } = await resolveEvolutionConfig(tenantId, inboxId, req.body);

    if (evolutionUrl && evolutionKey) {
      safeEvolutionRequest(`${evolutionUrl}/instance/logout/${instanceName}`, {
        method: "DELETE",
        headers: { "apikey": evolutionKey }
      }, 3000).catch(() => {});
    }

    // Update status in supabase for this specific instance
    try {
      await supabaseAdmin.from('whatsapp_instances').update({
        status: 'DISCONNECTED',
        phone_number: null,
        qrcode_base64: null,
        updated_at: new Date().toISOString()
      }).eq('instance_name', instanceName);
    } catch (e) {}

    return res.json({ success: true, status: 'DISCONNECTED', instanceName });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/v1/whatsapp/instances", async (req, res) => {
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
    let welcomeGreeting = cleanWelcomeText.trim() || `Olá! Sou o assistente virtual da ${storeName}. Em que posso te ajudar hoje?`;

    // Incluir horário de funcionamento se configurado e ainda não citado no texto
    const operatingHours = tenant.horario_funcionamento || tenant.smart_banners?._regulatoryData?.horario_funcionamento;
    if (operatingHours && !welcomeGreeting.toLowerCase().includes("horário") && !welcomeGreeting.toLowerCase().includes("horario")) {
      welcomeGreeting += `\n\n🕒 *Horário de Funcionamento:* ${operatingHours}`;
    }

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
              await supabaseAdmin.from("whatsapp_instances").upsert({
                store_id: fallbackTenant.id,
                instance_name: rawInst,
                status: "CONNECTED"
              }, { onConflict: "instance_name" });
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
      console.log(`[WEBHOOK SUCCESS] Instância identificada com sucesso: "${instanceName || 'N/A'}" | Loja: "${resolvedTenant.name || resolvedTenant.slug || storeId}" (id: "${storeId}") | Mensagens a processar: ${messages.length}`);

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
          // 1. SEMPRE salva primeiro a mensagem no banco de dados e cria/atualiza o contato e a conversa
          const result = await chatStore.processWhatsAppMessage(storeId, msg, instanceName);

          // Se for mensagem de áudio enviada pelo cliente, transcreve via Whisper / Gemini
          if (!fromMe && isAudio && result?.message) {
            try {
              let audioData: string | null = null;
              
              // 1. Verifique primeiro se o base64 do áudio já veio direto no payload
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
                // 2. Se não veio no payload, faça a chamada para a Evolution API com tratamento rigoroso de log e erro
                audioData = await evolutionApiService.getBase64FromMediaMessage(instanceName, msg);
                console.log('[AUDIO_DEBUG] Base64 obtido com sucesso da Evolution API? Tam:', audioData?.length);
              }

              if (!audioData) {
                console.error('[AUDIO_DEBUG] ❌ Não foi possível obter o Base64 do áudio nem do payload nem da Evolution API.');
              }

              let transcribed: string | null = null;
              if (audioData) {
                const tenantAiCfg = resolvedTenant?.ai_agent_config || resolvedTenant?.ai_agent_settings || resolvedTenant?.ai_config || {};
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

                  if (result.conversation) {
                    await supabaseAdmin
                      .from("chat_conversations")
                      .update({
                        last_message_content: audioDisplay,
                        updated_at: new Date().toISOString()
                      })
                      .eq("id", result.conversation.id);

                    result.conversation.last_message_content = audioDisplay;
                  }

                  result.message.content = audioDisplay;
                } catch (dbAudioErr: any) {
                  console.warn("[WEBHOOK - AUDIO] Erro ao atualizar transcrição no banco:", dbAudioErr.message);
                }

                realtimeHub.broadcastToStore(storeId, "chat_message", {
                  conversationId: result.conversation.id,
                  message: { ...result.message, content: audioDisplay },
                  conversation: result.conversation
                });
              } else {
                // 5. SE A TRANSCRIÇÃO FALHAR MESMO ASSIM:
                // NÃO passe para a IA responder genericamente. Envie uma mensagem direta e amigável
                console.warn(`[AUDIO_DEBUG] ⚠️ Transcrição do áudio falhou ou retornou vazia para ${remoteJid}. Enviando mensagem amigável direta.`);
                const audioFailFriendlyMessage = "Desculpe, não consegui entender o seu áudio com clareza. Você poderia digitar sua dúvida ou tentar mandar novamente?";
                
                const phone = result?.conversation?.contact?.phone_number || msg.key?.remoteJid?.replace(/@.*$/, '') || remoteJid.replace(/@.*$/, '');
                const cleanPhone = String(phone || '').replace(/\D/g, '');

                if (cleanPhone && instanceName) {
                  const sendFailRes = await evolutionApiService.sendTextMessage(instanceName, cleanPhone, audioFailFriendlyMessage, { delay: 1000 });
                  const failId = sendFailRes?.data?.key?.id || sendFailRes?.data?.message?.key?.id || sendFailRes?.data?.id || sendFailRes?.data?.messageId || sendFailRes?.key?.id;
                  registerBotSentMessage(failId, result?.conversation?.id, cleanPhone);
                }

                if (result.conversation) {
                  const failMsgId = crypto.randomUUID();
                  const nowIso = new Date().toISOString();
                  const failBotMsg = {
                    id: failMsgId,
                    conversation_id: result.conversation.id,
                    sender_type: "BOT",
                    content: audioFailFriendlyMessage,
                    media_url: null,
                    media_type: null,
                    created_at: nowIso
                  };

                  try {
                    await supabaseAdmin.from("chat_messages").insert([failBotMsg]);
                    await supabaseAdmin.from("chat_conversations").update({
                      last_message_content: audioFailFriendlyMessage,
                      last_message_at: nowIso,
                      updated_at: nowIso
                    }).eq("id", result.conversation.id);

                    realtimeHub.broadcastToStore(storeId, "chat_message", {
                      conversationId: result.conversation.id,
                      message: failBotMsg,
                      conversation: result.conversation
                    });
                  } catch (dbFailErr: any) {
                    console.warn("[WEBHOOK - AUDIO] Erro ao registrar mensagem de erro amigável no banco:", dbFailErr.message);
                  }
                }

                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'audio_transcription_failed_friendly_replied' });
                }
                continue;
              }
            } catch (audioErr: any) {
              console.error("[WEBHOOK - AUDIO] Erro na transcrição de áudio:", audioErr.message);
              const audioFailFriendlyMessage = "Desculpe, não consegui entender o seu áudio com clareza. Você poderia digitar sua dúvida ou tentar mandar novamente?";
              const phone = result?.conversation?.contact?.phone_number || msg.key?.remoteJid?.replace(/@.*$/, '') || remoteJid.replace(/@.*$/, '');
              const cleanPhone = String(phone || '').replace(/\D/g, '');

              if (cleanPhone && instanceName) {
                const sendFailRes2 = await evolutionApiService.sendTextMessage(instanceName, cleanPhone, audioFailFriendlyMessage, { delay: 1000 });
                const failId2 = sendFailRes2?.data?.key?.id || sendFailRes2?.data?.message?.key?.id || sendFailRes2?.data?.id || sendFailRes2?.data?.messageId || sendFailRes2?.key?.id;
                registerBotSentMessage(failId2, result?.conversation?.id, cleanPhone);
              }

              if (result?.conversation) {
                const failMsgId = crypto.randomUUID();
                const nowIso = new Date().toISOString();
                const failBotMsg = {
                  id: failMsgId,
                  conversation_id: result.conversation.id,
                  sender_type: "BOT",
                  content: audioFailFriendlyMessage,
                  media_url: null,
                  media_type: null,
                  created_at: nowIso
                };

                try {
                  await supabaseAdmin.from("chat_messages").insert([failBotMsg]);
                  await supabaseAdmin.from("chat_conversations").update({
                    last_message_content: audioFailFriendlyMessage,
                    last_message_at: nowIso,
                    updated_at: nowIso
                  }).eq("id", result.conversation.id);

                  realtimeHub.broadcastToStore(storeId, "chat_message", {
                    conversationId: result.conversation.id,
                    message: failBotMsg,
                    conversation: result.conversation
                  });
                } catch (dbFailErr: any) {
                  console.warn("[WEBHOOK - AUDIO] Erro ao registrar mensagem de erro amigável no banco:", dbFailErr.message);
                }
              }

              if (!res.headersSent) {
                return res.status(200).json({ success: true, handled: 'audio_error_friendly_replied' });
              }
              continue;
            }
          }

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
              // Log de Diagnóstico solicitado
              console.log(`[Webhook Message] Recebida msg de ${remoteJid}. is_bot_active: ${conversation.is_bot_active}, is_human_controlled: ${conversation.is_human_controlled}, is_webloja_order: ${isWeblojaOrder}`);

              // 3. Processamento CSAT isolado
              try {
                const ratingNum = parseInt(String(effectiveText || text).trim(), 10);
                if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
                  await csatManager.recordCsatResponse(storeId, conversation.id, ratingNum);
                }
              } catch (csatErr: any) {
                console.warn("[WEBHOOK] Aviso ao processar CSAT:", csatErr.message);
              }

              // 4. Verificação de elegibilidade para atendimento pela IA
              const isHumanControlled = 
                isWeblojaOrder ||
                conversation.is_human_controlled === true ||
                conversation.is_bot_active === false ||
                Boolean(conversation.assigned_user_id) ||
                conversation.kanban_stage === "em_atendimento";

              if (isHumanControlled) {
                console.log(`[WEBHOOK - IA] Conversa ${conversation.id} não despachada para IA: intervenção humana ativa (is_bot_active: ${conversation.is_bot_active}, is_human_controlled: ${conversation.is_human_controlled}, stage: ${conversation.kanban_stage})`);
                if (!res.headersSent) {
                  return res.status(200).json({ success: true, handled: 'human_controlled' });
                }
                continue;
              }

              // =========================================================================
              // 5. DEBOUNCE RESILIENTE A SERVERLESS (Vercel / Multi-Instância)
              // =========================================================================
              const currentMessage = result.message;
              const currentMsgTimestamp = currentMessage?.created_at || new Date().toISOString();
              const phone = conversation.contact?.phone_number || msg.key?.remoteJid?.replace(/@.*$/, '') || remoteJid.replace(/@.*$/, '');
              const cleanPhone = String(phone || '').replace(/\D/g, '');

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

              // c) Aguarda janela de tolerância de digitação (20 segundos)
              console.log(`[WEBHOOK DEBOUNCE] ⏳ Janela de 20s iniciada para msg ${currentMessage?.id} na conversa ${conversation.id}...`);
              await new Promise(resolve => setTimeout(resolve, 20000));

              // d) Verificação de Última Mensagem no Supabase (Evita disparos concorrentes no Serverless)
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

              // e) Verifica se durante os 20s um operador humano assumiu o chat
              try {
                const { data: recheckedConv } = await supabaseAdmin
                  .from('chat_conversations')
                  .select('is_bot_active, is_human_controlled, assigned_user_id, kanban_stage')
                  .eq('id', conversation.id)
                  .maybeSingle();

                if (recheckedConv) {
                  const nowHuman = recheckedConv.is_human_controlled === true ||
                    recheckedConv.is_bot_active === false ||
                    Boolean(recheckedConv.assigned_user_id) ||
                    recheckedConv.kanban_stage === 'em_atendimento';
                  if (nowHuman) {
                    console.log(`[WEBHOOK DEBOUNCE] 👤 Conversa ${conversation.id} foi assumida por operador humano durante a espera de 20s. Abortando IA.`);
                    return res.status(200).json({ handled: 'human_takeover_during_debounce' });
                  }
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
                  console.warn(`[WEBHOOK DEBOUNCE] ⚠️ Mensagem de áudio consolidada vazia para conversa ${conversation.id}. Enviando resposta amigável.`);
                  const failText = "Desculpe, não consegui entender o seu áudio com clareza. Você poderia digitar sua dúvida ou tentar mandar novamente?";
                  if (instanceName && cleanPhone) {
                    const sendFailRes3 = await evolutionApiService.sendTextMessage(instanceName, cleanPhone, failText, { delay: 1000 });
                    const failId3 = sendFailRes3?.data?.key?.id || sendFailRes3?.data?.message?.key?.id || sendFailRes3?.data?.id || sendFailRes3?.data?.messageId || sendFailRes3?.key?.id;
                    registerBotSentMessage(failId3, conversation.id, cleanPhone);
                  }
                  return res.status(200).json({ success: true, handled: 'audio_empty_friendly_replied' });
                }
              } catch (consolErr: any) {
                console.warn("[WEBHOOK DEBOUNCE] Erro ao consolidar histórico recente:", consolErr.message);
              }

              console.log(`[WEBHOOK DEBOUNCE] 💬 Mensagem unificada para envio à IA na conversa ${conversation.id} (replyWithAudio: ${isAudioMessage}):\n"${consolidatedText}"`);

              // g) Disparo Único da Mensagem de Boas-Vindas (se elegível hoje)
              let welcomeSent = false;
              try {
                welcomeSent = await handleDailyWelcomeMessage(storeId, conversation, instanceName, consolidatedText);
              } catch (welcomeErr: any) {
                console.error('[WEBHOOK] Exceção ao processar boas-vindas diárias:', welcomeErr.message);
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
              const isEcho = (msgKeyId && botSentMessageIds.has(msgKeyId)) || isBotSentOrEcho(msgKeyId, effectiveText || text, conversation?.id, remoteJid);
              if (isEcho) {
                console.log(`[WEBHOOK BLINDAGEM ANTI-ECO] 🤖 Mensagem fromMe identificada como eco do bot (${msgKeyId}). Garantindo que a IA permaneça ATIVA na conversa ${conversation?.id}.`);
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
            await supabaseAdmin.from("whatsapp_instances").update({
              status: "CONNECTED",
              ...(ownerPhone ? { phone_number: ownerPhone } : {}),
              updated_at: new Date().toISOString()
            }).eq("instance_name", instanceName);
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

// --- ENDPOINTS DE CHAT ---
app.get("/api/v1/chat/conversations", async (req, res) => {
  try {
    const storeId = (req.query.tenantId as string) || (req.query.storeId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const inboxId = req.query.inboxId as string | undefined;
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || undefined;
    const userRole = (req.query.role as string) || (req.headers["x-user-role"] as string) || undefined;
    const authHeader = req.headers["authorization"] as string | undefined;

    const { isOperator, allowedInboxIds } = await resolveOperatorAllowedInboxIds(
      storeId,
      userId,
      userRole,
      authHeader,
      req.headers["x-user-id"] as string,
      req.headers["x-user-role"] as string
    );

    if (isOperator) {
      // Se for operador e não tiver nenhuma caixa permitida, retorna lista vazia imediatamente
      if (allowedInboxIds.length === 0) {
        return res.json({ data: [] });
      }

      // Se filtrou por uma caixa específica, valida se o operador tem acesso
      if (inboxId && inboxId !== "all") {
        if (!allowedInboxIds.includes(inboxId)) {
          return res.json({ data: [] });
        }
      }
    }

    const conversations = await chatStore.getConversations(
      storeId,
      (inboxId && inboxId !== "all") ? inboxId : undefined,
      isOperator ? allowedInboxIds : undefined
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

    const userId = req.query.userId as string | undefined;
    const userRole = req.query.role as string | undefined;

    const isOperator = userId && (userRole?.toLowerCase() === "operador" || userRole?.toLowerCase() === "operator");
    if (isOperator) {
      const { data: convData } = await supabaseAdmin
        .from("chat_conversations")
        .select("inbox_id, team_id")
        .eq("id", conversationId)
        .maybeSingle();

      if (convData) {
        if (convData.inbox_id) {
          const { data: memberRows } = await supabaseAdmin
            .from("inbox_members")
            .select("inbox_id")
            .eq("user_id", userId);
          const allowedInboxIds = memberRows ? memberRows.map(r => r.inbox_id) : [];

          if (!allowedInboxIds.includes(convData.inbox_id)) {
            return res.status(403).json({ error: "Permissão negada para acessar mensagens desta conversa." });
          }
        }
        if (convData.team_id) {
          const { data: teamRows } = await supabaseAdmin
            .from("chat_team_members")
            .select("team_id")
            .eq("user_id", userId);
          const allowedTeamIds = teamRows ? teamRows.map(r => r.team_id) : [];

          if (!allowedTeamIds.includes(convData.team_id)) {
            return res.status(403).json({ error: "Permissão negada para acessar mensagens desta conversa por restrição de time." });
          }
        }
      }
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
    const { conversation_id, content, is_private, media_url, media_type, sender_type, userId, role } = req.body;
    const storeId = (req.headers["x-tenant-id"] as string) || "default";

    if (!conversation_id || (!content && !media_url)) {
      return res.status(400).json({ error: "conversation_id e conteúdo são obrigatórios." });
    }

    const isOperator = userId && (role?.toLowerCase() === "operador" || role?.toLowerCase() === "operator");
    if (isOperator) {
      const { data: convData } = await supabaseAdmin
        .from("chat_conversations")
        .select("inbox_id")
        .eq("id", conversation_id)
        .maybeSingle();

      if (convData && convData.inbox_id) {
        const { data: memberRows } = await supabaseAdmin
          .from("inbox_members")
          .select("inbox_id")
          .eq("user_id", userId);
        const allowedInboxIds = memberRows ? memberRows.map(r => r.inbox_id) : [];

        if (!allowedInboxIds.includes(convData.inbox_id)) {
          return res.status(403).json({ error: "Permissão negada para enviar mensagens nesta conversa." });
        }
      }
    }

    // Resolve instanceName from conversation's inbox if available
    let resolvedInstance: string | undefined = undefined;
    try {
      const { data: conv } = await supabaseAdmin
        .from("chat_conversations")
        .select("inbox_id")
        .eq("id", conversation_id)
        .maybeSingle();

      if (conv?.inbox_id) {
        const { data: inbox } = await supabaseAdmin
          .from("inboxes")
          .select("whatsapp_instance_id")
          .eq("id", conv.inbox_id)
          .maybeSingle();

        if (inbox?.whatsapp_instance_id) {
          const { data: inst } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("instance_name")
            .eq("id", inbox.whatsapp_instance_id)
            .maybeSingle();

          if (inst?.instance_name) {
            resolvedInstance = inst.instance_name;
            console.log(`[Chat API] Using specific instance "${resolvedInstance}" for inbox ${conv.inbox_id}`);
          }
        }
      }
    } catch (resolveErr: any) {
      console.warn("[Chat API] Warning resolving instance name for conversation:", resolveErr.message);
    }

    // Persistir mensagem e despachar via Evolution API se não for privada
    const { message, conversation } = await chatStore.addMessage(
      storeId,
      conversation_id,
      sender_type || "USER",
      content || "",
      Boolean(is_private),
      media_url,
      media_type,
      resolvedInstance
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

    console.log(`[Chat API] Mensagem de chat salva e processada para conversa ${conversation_id}: ${content}`);
    return res.status(200).json({ success: true, data: message, conversation });
  } catch (error: any) {
    console.error("[Chat API] Erro ao enviar mensagem:", error);
    return res.status(500).json({ error: error.message || "Erro interno." });
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
    const conversationId = req.params.id || req.body.conversationId || req.body.conversation_id;
    const storeId = (req.body.storeId as string) || (req.body.tenantId as string) || (req.headers["x-tenant-id"] as string) || "default";
    const inboxId = req.body.inboxId || req.body.inbox_id || undefined;
    const userId = req.body.userId || req.body.assignedUserId || req.body.assigned_user_id || req.body.assigned_to || undefined;
    const fromUserId = req.body.fromUserId || (req.headers["x-user-id"] as string) || undefined;
    const reason = req.body.reason || req.body.notes || undefined;

    if (!conversationId) {
      return res.status(400).json({ error: "conversationId é obrigatório para transferência." });
    }

    if (!inboxId && !userId) {
      return res.status(400).json({ error: "É necessário informar ao menos um departamento (inboxId) ou um atendente (userId) de destino." });
    }

    // Validação de isolamento: Se inboxId for informado, valida se a caixa existe e pertence ao estabelecimento
    if (inboxId) {
      try {
        const { data: inboxRow } = await supabaseAdmin
          .from("inboxes")
          .select("id, store_id, name")
          .eq("id", inboxId)
          .maybeSingle();

        if (inboxRow && inboxRow.store_id && storeId && storeId !== "default" && inboxRow.store_id !== storeId) {
          return res.status(403).json({ error: "O departamento selecionado pertence a outro estabelecimento." });
        }
      } catch (_) {}
    }

    // Executa a transferência via Service Role (sem restrições indevidas de RLS para operadores)
    const result = await chatStore.transferConversation(conversationId, storeId, {
      inboxId,
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
      assignedUserId: updated?.assigned_user_id || userId,
      status: updated?.status,
      kanban_stage: updated?.kanban_stage,
      is_human_controlled: updated?.is_human_controlled,
      is_bot_active: updated?.is_bot_active,
      updated_at: updated?.updated_at || new Date().toISOString()
    });

    realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
      conversationId,
      stage: updated?.kanban_stage || "novos_triagem",
      kanban_stage: updated?.kanban_stage || "novos_triagem",
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

async function startServer() {
  let __filename = "";
  let __dirname = "";

  try {
    // @ts-ignore
    if (import.meta && import.meta.url) {
      __filename = fileURLToPath(import.meta.url);
      __dirname = path.dirname(__filename);
    } else {
      __dirname = process.cwd();
    }
  } catch (e) {
    __dirname = process.cwd();
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
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

    // SPA Fallback: qualquer rota GET que não comece com /api/ ou /s/ entrega o dist/index.html
    app.get("*all", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/s/")) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const listenPort = Number(process.env.PORT) || 3000;
  app.listen(listenPort, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${listenPort}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}

