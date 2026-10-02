import { createClient } from '@supabase/supabase-js';

// Suporte flexível a variáveis com ou sem prefixo VITE_ e fallback garantido com chaves do projeto
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://nalshjhoiecxooejpiaw.supabase.co';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';

const DEFAULT_SHARE_IMAGE = 'https://farmaflow.online/preview-share.png';

export function isCrawlerRequest(userAgent: string = ''): boolean {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|skypeuripreview/i.test(
    userAgent
  );
}

export function buildCrawlerHtml(store: {
  nome_loja: string;
  logo_url?: string;
  descricao?: string;
}): string {
  const esc = (str: string = '') =>
    str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const nomeLoja = esc(store.nome_loja || 'FarmaFlow - Drogaria e Perfumaria Online');
  let logoUrl = (store.logo_url || '').trim();

  if (!logoUrl.startsWith('http://') && !logoUrl.startsWith('https://')) {
    logoUrl = DEFAULT_SHARE_IMAGE;
  }
  logoUrl = esc(logoUrl);

  const descricao = esc(
    store.descricao ||
      'Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas.'
  );

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${nomeLoja}</title>
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
  <meta name="twitter:description" content="${descricao}" />
  <meta name="twitter:image" content="${logoUrl}" />
</head>
<body>
  <p>A redirecionar para a loja online...</p>
  <script>window.location.href = "/";</script>
</body>
</html>`;
}

export default async function handler(req: any, res: any) {
  try {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
    const hostStr = Array.isArray(host) ? host[0] : String(host);

    // Extrair subdomínio (ex: farmaciatrevo de farmaciatrevo.farmaflow.online)
    let slug =
      (req.query?.store as string) ||
      (req.query?.slug as string) ||
      (req.query?.loja as string) ||
      (req.query?.tenant as string) ||
      '';

    // Se não veio por query param, extrair do path (/loja/:slug ou /api/og/:slug)
    if (!slug && req.url) {
      const pathMatch = req.url.match(/(?:\/loja|\/store|\/api\/og)\/([^\/?#]+)/i);
      if (pathMatch && pathMatch[1]) {
        slug = decodeURIComponent(pathMatch[1]).trim();
      }
    }

    // Se ainda não tiver slug, extrair a partir do subdomínio do host
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

    let storeName = 'FarmaFlow - Drogaria e Perfumaria Online';
    let logoUrl = DEFAULT_SHARE_IMAGE;
    let description =
      'Faça seu pedido online com tele-entrega rápida direta no WhatsApp. Medicamentos, perfumaria e ofertas exclusivas.';

    if (supabaseUrl && supabaseKey && slug) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const cleanSlug = slug.toLowerCase().trim();

        // Consulta resiliente com tolerância a slug, subdomínio, id ou custom_domain
        const { data: store, error } = await supabase
          .from('tenants')
          .select('name, nome_loja, razao_social, logo_url, logo, description, banner_subtitle')
          .or(`slug.ilike.${cleanSlug},id.eq.${cleanSlug},custom_domain.ilike.${cleanSlug}`)
          .maybeSingle();

        if (!error && store) {
          storeName = store.nome_loja || store.name || store.razao_social || storeName;
          const possibleLogo = store.logo_url || store.logo;
          if (possibleLogo && typeof possibleLogo === 'string' && possibleLogo.startsWith('http')) {
            logoUrl = possibleLogo;
          }
          if (store.description || store.banner_subtitle) {
            description = store.description || store.banner_subtitle;
          }
        } else {
          // Busca flexível secundária
          const { data: allStores } = await supabase
            .from('tenants')
            .select('name, nome_loja, razao_social, logo_url, logo, slug, id, custom_domain')
            .limit(50);

          if (allStores && allStores.length > 0) {
            const cleanNorm = cleanSlug
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]/g, '');

            const found = allStores.find((t: any) => {
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
              const n = (t.name || t.nome_loja || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');
              return s === cleanNorm || i === cleanNorm || n === cleanNorm;
            });

            if (found) {
              storeName = found.nome_loja || found.name || found.razao_social || storeName;
              const possibleLogo = found.logo_url || found.logo;
              if (possibleLogo && typeof possibleLogo === 'string' && possibleLogo.startsWith('http')) {
                logoUrl = possibleLogo;
              }
            }
          }
        }
      } catch (dbErr) {
        console.warn('[og-handler] Erro não fatal ao consultar Supabase, usando valores padrão:', dbErr);
      }
    }

    // Cabeçalho HTML com metadados Open Graph dinâmicos
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${storeName}</title>
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${storeName}" />
  <meta property="og:title" content="${storeName} - Peça Online" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${logoUrl}" />
  <meta property="og:image:secure_url" content="${logoUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${storeName}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${logoUrl}" />
</head>
<body>
  <p>A redirecionar para a loja online...</p>
  <script>window.location.href = "/";</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).send(html);
  } catch (err: any) {
    // Fallback seguro: nunca retornar erro 500 para não quebrar os robôs do WhatsApp nem a navegação
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
