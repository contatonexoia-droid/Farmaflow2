const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

if (!content.includes('import rateLimit')) {
  content = content.replace('import express from "express";', 'import express from "express";\nimport rateLimit from "express-rate-limit";');
}

const newRoute = `
// Rate Limiter para a rota de cálculo de frete
const deliveryFeeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 10, // Máximo de 10 requisições por IP por minuto
  message: { error: "Muitas requisições para cálculo de frete. Tente novamente em alguns segundos." },
  standardHeaders: true,
  legacyHeaders: false,
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
      .select('delivery_settings, full_address, fullAddress')
      .eq('id', tenantId)
      .single();
      
    if (error || !tenant) {
      return res.status(404).json({ error: "Farmácia não encontrada." });
    }

    const settings = tenant.delivery_settings;
    const storeAddress = tenant.full_address || tenant.fullAddress;
    
    // Fallback: If no settings or disabled, free delivery
    if (!settings || !settings.enabled) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Check for Free Delivery by order amount
    if (settings.minOrderForFreeDelivery && orderTotal >= settings.minOrderForFreeDelivery) {
      return res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
    }

    // Fixed Fee
    if (!settings.type || settings.type === 'fixed') {
      return res.json({ fee: settings.fee || 0, isFreeDelivery: false, distanceKm: 0, success: true });
    }

    // Dynamic Fee - Needs distance calculation
    if (settings.type === 'dynamic') {
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
        // 2. Calculate Distance using Google Maps API
        const distanceResult = await calculateDeliveryDistance(storeAddress, customerAddress);
        
        // Security Fallback 2: Se a API falhar (ex: OVER_QUERY_LIMIT)
        if (!distanceResult.success) {
          console.warn("Falha na API de Mapas:", distanceResult.message);
          
          if (distanceResult.isFallback) {
             return res.json({
               fee: settings.fee || 0, 
               isFreeDelivery: false,
               distanceKm: 0,
               success: false,
               message: "Cota de cálculo excedida. O frete será combinado com a farmácia.",
               fallback: true
             });
          }

          return res.json({
            fee: settings.fee || 0,
            isFreeDelivery: false,
            distanceKm: 0,
            success: false,
            message: "Não foi possível calcular a distância exata. Aplicando taxa base.",
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

      // 3. Consult delivery_fees table for the exact range
      const { data: feeRange, error: feeError } = await supabaseAdmin
        .from('delivery_fees')
        .select('fee')
        .eq('tenant_id', tenantId)
        .lte('min_km', distanceKm)
        .gte('max_km', distanceKm)
        .limit(1)
        .single();

      if (feeError || !feeRange) {
        // Checking if distance exceeds all ranges
        const { data: maxRange } = await supabaseAdmin
          .from('delivery_fees')
          .select('max_km')
          .eq('tenant_id', tenantId)
          .order('max_km', { ascending: false })
          .limit(1)
          .single();
          
        if (maxRange && distanceKm > maxRange.max_km) {
           return res.json({ 
             fee: 0, 
             isFreeDelivery: false, 
             distanceKm, 
             success: false, 
             message: "Seu endereço está fora da nossa área de entrega." 
           });
        }
        
        // Check if ranges exist in JSON as fallback
        if (settings.ranges && settings.ranges.length > 0) {
           const sortedRanges = [...settings.ranges].sort((a, b) => a.minKm - b.minKm);
           for (const range of sortedRanges) {
             if (distanceKm >= range.minKm && distanceKm <= range.maxKm) {
               return res.json({ fee: range.fee, isFreeDelivery: false, distanceKm, success: true });
             }
           }
        }

        return res.json({ 
          fee: settings.fee || 0, 
          isFreeDelivery: false, 
          distanceKm, 
          success: false, 
          message: "Nenhuma faixa de entrega encontrada para esta distância.",
          fallback: true
        });
      }

      return res.json({ 
        fee: feeRange.fee, 
        isFreeDelivery: false, 
        distanceKm, 
        success: true 
      });
    }

    res.json({ fee: 0, isFreeDelivery: true, distanceKm: 0, success: true });
  } catch (err) {
    console.error("Erro no delivery-fee:", err);
    res.status(500).json({ error: err.message });
  }
});`;

// Remove the old block and replace with the new block including rate limit
const oldRouteRegex = /app\.post\("\/api\/checkout\/delivery-fee", async \(req, res\) => \{[\s\S]*?res\.status\(500\)\.json\(\{ error: err\.message \}\);\s*\}\s*\}\);/m;

content = content.replace(oldRouteRegex, newRoute.trim());
fs.writeFileSync('server.ts', content);
