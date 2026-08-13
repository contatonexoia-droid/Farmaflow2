const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
app.put("/api/v1/tenants/:tenantId/products/bulk", checkTenantAccess, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { products } = req.body;
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: "Invalid products array" });
    }
    
    // Ensure all products belong to the tenant
    const dbProducts = products.map(p => ({
      ...p,
      tenant_id: tenantId,
      // Fallback for tenantid just in case
      tenantid: p.tenantid || tenantId
    }));
    
    const CHUNK_SIZE = 50;
    for (let i = 0; i < dbProducts.length; i += CHUNK_SIZE) {
      const chunk = dbProducts.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin.from("products").upsert(chunk);
      if (error) {
        console.error("Bulk upsert error:", error);
        return res.status(500).json({ error: error.message });
      }
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("Bulk upsert exception:", error);
    res.status(500).json({ error: error.message });
  }
});
`;

if (!code.includes('/api/v1/tenants/:tenantId/products/bulk')) {
    code = code.replace('app.get("/api/v1/tenants/:tenantId/products", async (req, res) => {', newEndpoint + '\napp.get("/api/v1/tenants/:tenantId/products", async (req, res) => {');
    fs.writeFileSync('server.ts', code);
    console.log('Added bulk endpoint');
} else {
    console.log('Endpoint already exists');
}
