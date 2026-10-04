import { createClient } from '@supabase/supabase-js';

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

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export default async function handler(req: any, res: any) {
  const slugParam = req.query?.slug || req.query?.store || req.query?.id || '';
  const rawSlug = Array.isArray(slugParam) ? slugParam[0] : String(slugParam);
  const cleanSlug = (rawSlug || 'drogaria-esplendido')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '');

  let tenant: any = null;

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

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

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
}
