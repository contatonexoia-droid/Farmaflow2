import { createClient } from '@supabase/supabase-js';

// Suporte flexível a variáveis, priorizando estritamente a chave administrativa para ignorar o RLS
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nalshjhoiecxooejpiaw.supabase.co';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';

const DEFAULT_SHARE_IMAGE = 'https://farmaflow.online/preview-share.png';

export function isCrawlerRequest(userAgent: string = ''): boolean {
  if (!userAgent) return false;
  return /facebookexternalhit|whatsapp|facebot|twitterbot|linkedinbot/i.test(userAgent);
}

function detectImageType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
  if (lower.includes('.webp')) return 'image/webp';
  return 'image/png';
}

export function buildCrawlerHtml(store: {
  trade_name?: string;
  nome_loja?: string;
  name?: string;
  razao_social?: string;
  logo_url?: string;
  descricao?: string;
  description?: string;
  url?: string;
}): string {
  const esc = (str: string = '') =>
    str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const titleName = esc(
    store.trade_name ||
      store.name ||
      store.nome_loja ||
      store.razao_social ||
      'Drogaria Explendido'
  );

  let logoUrl = (store.logo_url || '').trim();
  if (logoUrl.startsWith('http://')) {
    logoUrl = logoUrl.replace('http://', 'https://');
  }
  if (!logoUrl.startsWith('https://')) {
    logoUrl = 'https://nalshjhoiecxooejpiaw.supabase.co/storage/v1/object/public/product-images/logos/nosso-catalogo_logo_1790958337014.png';
  }
  const safeLogo = esc(logoUrl);
  const imageType = detectImageType(logoUrl);

  const descName = esc(store.trade_name || 'nossa drogaria');
  const description = esc(`Faça seu pedido online com rapidez e comodidade na ${descName}.`);
  const currentUrl = esc(store.url || 'https://drogaria-esplendido.farmaflow.online');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${titleName}</title>
  <meta property="og:title" content="${titleName}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${safeLogo}" />
  <meta property="og:image:secure_url" content="${safeLogo}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:url" content="${currentUrl}" />
  <meta property="og:type" content="website" />
</head>
<body></body>
</html>`;
}

export default async function handler(req: any, res: any) {
  try {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
    const hostStr = Array.isArray(host) ? host[0] : String(host);

    // 1. Obter identificador / subdomínio da requisição
    let slug =
      (req.query?.store as string) ||
      (req.query?.slug as string) ||
      (req.query?.loja as string) ||
      (req.query?.tenant as string) ||
      (req.query?.id as string) ||
      '';

    // Extrair subdomínio (ex: farmacia-trevo-rio-dourado de farmacia-trevo-rio-dourado.farmaflow.online)
    if (!slug && hostStr.includes('.')) {
      const parts = hostStr.split('.');
      if (
        parts[0] !== 'www' &&
        parts[0] !== 'farmaflow' &&
        parts[0] !== 'nexoia' &&
        parts[0] !== 'app' &&
        parts[0] !== 'admin' &&
        parts[0] !== 'api' &&
        parts[0] !== 'portal'
      ) {
        slug = parts[0];
      }
    }

    // Se ainda não veio por query ou host, extrair do path (/loja/:slug ou /api/og/:slug)
    if (!slug && req.url) {
      const pathMatch = req.url.match(/(?:\/loja|\/store|\/api\/og)\/([^\/?#]+)/i);
      if (pathMatch && pathMatch[1]) {
        slug = decodeURIComponent(pathMatch[1]).trim();
      }
    }

    let storeName = 'FarmaFlow - Drogaria e Perfumaria Online';
    let logoUrl = DEFAULT_SHARE_IMAGE;
    let description =
      'Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas.';

    if (supabaseUrl && supabaseKey && slug) {
      try {
        // Inicializa o cliente do Supabase com service_role para ignorar o RLS
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const cleanSlug = slug.toLowerCase().trim();

        // Consulta selecionando todos os campos com tolerância a slug ou id
        let { data: store } = await supabase
          .from('tenants')
          .select('*')
          .or(`slug.eq.${cleanSlug},id.eq.${cleanSlug}`)
          .maybeSingle();

        // Fallback: se não encontrou com eq exato, buscar na lista de tenants
        if (!store) {
          const { data: allTenants } = await supabase
            .from('tenants')
            .select('*')
            .limit(100);

          if (allTenants && allTenants.length > 0) {
            const cleanNorm = cleanSlug
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]/g, '');

            store =
              allTenants.find((t: any) => {
                const s = (t.slug || '')
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]/g, '');
                const i = (t.id || '')
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]/g, '');
                const n = (t.name || t.nome_loja || t.razao_social || '')
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]/g, '');
                const tn = (t.trade_name || '')
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^a-z0-9]/g, '');
                const c = (t.custom_domain || '').toLowerCase().trim();

                if (
                  s === cleanNorm ||
                  i === cleanNorm ||
                  n === cleanNorm ||
                  tn === cleanNorm ||
                  c === cleanSlug ||
                  c === hostStr.toLowerCase()
                ) {
                  return true;
                }

                // Equivalência fonética / ortográfica para esplendido / explendido
                if (
                  cleanNorm.replace(/x/g, 's') === s.replace(/x/g, 's') ||
                  cleanNorm.replace(/x/g, 's') === n.replace(/x/g, 's') ||
                  cleanNorm.replace(/x/g, 's') === tn.replace(/x/g, 's')
                ) {
                  return true;
                }

                return false;
              }) || null;
          }
        }

        // Se store for encontrado, aplicar os dados da drogaria
        if (store) {
          storeName =
            store.trade_name ||
            store.nome_loja ||
            store.razao_social ||
            store.name ||
            storeName;

          const candidateLogo = (store.logo_url || store.logo || store.smart_banners?._regulatoryData?.logo_url || '').trim();
          if (
            candidateLogo &&
            (candidateLogo.startsWith('http://') || candidateLogo.startsWith('https://')) &&
            !candidateLogo.startsWith('data:')
          ) {
            logoUrl = candidateLogo.startsWith('http://') ? candidateLogo.replace('http://', 'https://') : candidateLogo;
          } else if (store?.id) {
            const baseOrigin = hostStr ? `https://${hostStr}` : 'https://drogaria-esplendido.farmaflow.online';
            logoUrl = `${baseOrigin}/api/v1/store/${encodeURIComponent(store.id)}/logo.png`;
          }

          if (store.trade_name) {
            description = `Faça seu pedido online com rapidez e comodidade na ${store.trade_name}.`;
          } else if (store.name) {
            description = `Faça seu pedido online com rapidez e comodidade na ${store.name}.`;
          }
        }
      } catch (dbErr) {
        console.warn('[og-handler] Erro na consulta do Supabase:', dbErr);
      }
    }

    const esc = (str: string = '') =>
      str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const safeTitle = esc(storeName);
    const safeLogo = esc(logoUrl);
    const safeDesc = esc(description);
    const imageType = detectImageType(logoUrl);
    const safeUrl = esc(hostStr ? `https://${hostStr}` : 'https://drogaria-esplendido.farmaflow.online');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="${safeLogo}" />
  <meta property="og:image:secure_url" content="${safeLogo}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:url" content="${safeUrl}" />
  <meta property="og:type" content="website" />
</head>
<body></body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    return res.status(200).send(html);
  } catch (err: any) {
    console.error('Erro no og-handler:', err);
    const fallbackHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>FarmaFlow Online</title>
  <meta property="og:title" content="FarmaFlow Online" />
  <meta property="og:image" content="https://farmaflow.online/preview-share.png" />
  <meta property="og:image:secure_url" content="https://farmaflow.online/preview-share.png" />
</head>
<body>
  <p>A redirecionar...</p>
  <script>window.location.href = "/";</script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(fallbackHtml);
  }
}
