import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";

const supabase = createClient(supabaseUrl, supabaseKey);

const DEFAULT_SHARE_IMAGE = "https://farmaflow.online/preview-share.png";

/**
 * Detecta se a requisição provém de um crawler de compartilhamento em redes sociais ou WhatsApp
 */
export function isCrawlerRequest(userAgent: string = ""): boolean {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview/i.test(
    userAgent
  );
}

/**
 * Extrai o identificador da loja (slug, subdomínio ou id) a partir de query params, path ou header Host
 */
export function extractStoreIdentifier(req: any): string {
  // 1. Parâmetros de query explícitos
  const query = req.query || {};
  const queryParam = query.store || query.slug || query.loja || query.tenant || query.id || query.p;
  if (queryParam) return String(queryParam).trim();

  // 2. Extração do caminho da URL (ex: /loja/:slug ou /api/og/:slug)
  const url = (req.url || "").split("?")[0];
  const pathMatch = url.match(/(?:\/loja|\/store|\/api\/og)\/([^\/?#]+)/i);
  if (pathMatch && pathMatch[1]) {
    return decodeURIComponent(pathMatch[1]).trim();
  }

  // 3. Extração a partir do subdomínio do Host (ex: farmacia-trevo-rio-dourado.farmaflow.online)
  const rawHost = (req.headers?.["x-forwarded-host"] || req.headers?.host || "")
    .toString()
    .toLowerCase()
    .split(":")[0];

  if (rawHost) {
    // Se for domínio customizado da drogaria
    if (
      !rawHost.includes("farmaflow.online") &&
      !rawHost.includes("nexoia.online") &&
      !rawHost.includes("localhost") &&
      !rawHost.includes("run.app") &&
      !rawHost.includes("vercel.app")
    ) {
      return rawHost;
    }

    // Se for subdomínio FarmaFlow
    const parts = rawHost.split(".");
    if (parts.length >= 3) {
      const sub = parts[0];
      if (!["www", "app", "admin", "api", "portal", "preview", "dev", "ais-dev", "ais-pre"].includes(sub)) {
        return sub;
      }
    }
  }

  return "";
}

/**
 * Resolve os dados oficiais da drogaria no Supabase
 */
export async function resolveStoreData(identifier: string): Promise<any> {
  if (!identifier) return null;
  const clean = identifier.toLowerCase().trim();

  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, slug, logo_url, logo, custom_domain, banner_subtitle, description, razao_social, smart_banners")
      .or(`slug.ilike.${clean},id.eq.${clean},custom_domain.ilike.${clean}`)
      .maybeSingle();

    if (tenant) return tenant;

    // Busca flexível comparando slugs normalizados
    const { data: allTenants } = await supabase
      .from("tenants")
      .select("id, name, slug, logo_url, logo, custom_domain, banner_subtitle, description, razao_social, smart_banners")
      .limit(100);

    if (allTenants && allTenants.length > 0) {
      const cleanNorm = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const found = allTenants.find((t: any) => {
        const s = (t.slug || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        const i = (t.id || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        const n = (t.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        const c = (t.custom_domain || "").toLowerCase().trim();
        return s === cleanNorm || i === cleanNorm || n === cleanNorm || c === clean;
      });
      if (found) return found;
    }
  } catch (err) {
    console.error("[OGHandler] Erro ao consultar drogaria no Supabase:", err);
  }

  return null;
}

/**
 * Constrói a resposta HTML enxuta com as tags Open Graph dinâmicas para rastreadores
 */
export function buildCrawlerHtml(store: {
  nome_loja: string;
  logo_url?: string;
  descricao?: string;
}): string {
  const esc = (str: string = "") =>
    str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const nomeLoja = esc(store.nome_loja || "FarmaFlow Drogaria");
  let logoUrl = (store.logo_url || "").trim();

  // WhatsApp e crawlers exigem URL pública HTTP/HTTPS absoluta
  if (!logoUrl.startsWith("http://") && !logoUrl.startsWith("https://")) {
    logoUrl = DEFAULT_SHARE_IMAGE;
  }
  logoUrl = esc(logoUrl);

  const descricao = esc(
    store.descricao ||
      "Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas."
  );

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${nomeLoja} - Farmácia e Perfumaria Online</title>
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${nomeLoja}" />
  <meta property="og:title" content="${nomeLoja} - Peça Online" />
  <meta property="og:description" content="${descricao}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${nomeLoja}" />
  <meta name="twitter:image" content="${logoUrl}" />
</head>
<body>
  <script>window.location.href = window.location.href;</script>
</body>
</html>`;
}

/**
 * Handler Serverless Vercel / Express
 */
export default async function handler(req: any, res: any) {
  const userAgent = (req.headers?.["user-agent"] as string) || "";
  const isCrawler = isCrawlerRequest(userAgent);
  const identifier = extractStoreIdentifier(req);

  // 1. Se NÃO for um crawler (usuário comum navegando na web)
  if (!isCrawler) {
    // Serve a SPA (index.html)
    const distHtml = path.join(process.cwd(), "dist", "index.html");
    const rootHtml = path.join(process.cwd(), "index.html");
    const filePath = fs.existsSync(distHtml) ? distHtml : rootHtml;

    if (fs.existsSync(filePath)) {
      const htmlContent = fs.readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.status(200).send(htmlContent);
    }

    // Se estiver em ambiente sem acesso direto a arquivos, redireciona para a rota da loja
    const redirectTarget = identifier ? `/loja/${encodeURIComponent(identifier)}` : "/";
    res.writeHead(302, { Location: redirectTarget });
    return res.end();
  }

  // 2. Se FOR um crawler: resolve os metadados da loja atual
  let storeData: any = null;
  if (identifier) {
    storeData = await resolveStoreData(identifier);
  }

  const nomeLoja =
    storeData?.nome_loja ||
    storeData?.name ||
    storeData?.razao_social ||
    "FarmaFlow Drogaria";

  const rawLogo =
    storeData?.logo_url ||
    storeData?.logo ||
    storeData?.smart_banners?._regulatoryData?.logo_url ||
    DEFAULT_SHARE_IMAGE;

  const descricao =
    storeData?.descricao ||
    storeData?.banner_subtitle ||
    storeData?.description ||
    "Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas.";

  const html = buildCrawlerHtml({
    nome_loja: nomeLoja,
    logo_url: rawLogo,
    descricao,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).send(html);
}
