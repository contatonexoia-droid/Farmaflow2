const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const newImports = `
import { calculateDeliveryDistance } from "./lib/maps.js";
`;

const newRoute = `
app.post("/api/checkout/delivery-fee", async (req, res) => {
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

      // 2. Calculate Distance
      const distanceResult = await calculateDeliveryDistance(storeAddress, customerAddress);
      
      // Security Fallback 2: If Maps API fails
      if (!distanceResult.success) {
        console.warn("Falha na API de Mapas:", distanceResult.message);
        return res.json({
          fee: settings.fee || 0, // Fallback to base fixed fee
          isFreeDelivery: false,
          distanceKm: 0,
          success: false,
          message: "Não foi possível calcular a distância exata. Aplicando taxa base.",
          fallback: true
        });
      }

      const distanceKm = distanceResult.distanceKm;

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
             message: "Fora da área de entrega." 
           });
        }
        
        // Check if ranges exist in JSON as fallback (some apps might migrate progressively)
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
});

app.post("/api/checkout/calculate-delivery", async (req, res) => {`;

if (!content.includes('lib/maps.js')) {
  content = content.replace('import { checkTenantAccess } from "./checkTenantAccess.js";', 'import { checkTenantAccess } from "./checkTenantAccess.js";\n' + newImports);
}
content = content.replace('app.post("/api/checkout/calculate-delivery", async (req, res) => {', newRoute);
fs.writeFileSync('server.ts', content);
