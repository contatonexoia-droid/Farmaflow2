const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const newRoute = `
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

    if (!settings.type || settings.type === 'fixed') {
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

app.get("/api/checkout/address-lookup", async (req, res) => {`;

content = content.replace('app.get("/api/checkout/address-lookup", async (req, res) => {', newRoute);
fs.writeFileSync('server.ts', content);
