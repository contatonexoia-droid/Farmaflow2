const fs = require('fs');

let serverCode = fs.readFileSync('server.ts', 'utf-8');

// 1. Fix Cron Job ERP URL
serverCode = serverCode.replace(
  `if (!tenant.erp_url || !tenant.erp_url.startsWith("http")) {`,
  `if (!tenant.erp_url) {`
).replace(
  `console.log(\`[Cron] Skipping tenant \${tenant.id} due to invalid ERP URL: \${tenant.erp_url}\`);\n            continue;`,
  `// URL sanitization logic moved below`
).replace(
  `console.log(\n            \`[Cron] Reconciling tenant \${tenant.id} with ERP \${tenant.erp_url}...\`,\n          );\n\n          // Simula a chamada ao ERP para buscar o dump de estoque\n          // Na vida real, isso seria um fetch para o tenant.erp_url\n          const response = await fetch(\`\${tenant.erp_url}/api/stock-dump\`, {`,
  `const sanitizedUrl = tenant.erp_url.startsWith('http://') || tenant.erp_url.startsWith('https://') 
              ? tenant.erp_url 
              : \`https://\${tenant.erp_url}\`;
              
          console.log(\`[AGENTE] Iniciando conciliação para tenant \${tenant.id}...\`);
          console.log(\`[AGENTE] Status: ONLINE para tenant \${tenant.id}\`);
          
          try {
            await supabaseAdmin.from('agent_integrations').upsert({ 
              tenant_id: tenant.id,
              last_seen: new Date().toISOString(), 
              is_active: true 
            }, { onConflict: 'tenant_id' });
          } catch (e) {}
          
          console.log(\`[Cron] Reconciling tenant \${tenant.id} with ERP \${sanitizedUrl}...\`);
          const response = await fetch(\`\${sanitizedUrl}/api/stock-dump\`, {`
);

// Add endpoint for stock deduction
const stockEndpoint = `
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
          
        console.log(\`[ESTOQUE] Produto ID \${item.id} atualizado após venda. Novo estoque: \${newStock}\`);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("Erro ao deduzir estoque:", err);
    res.status(500).json({ error: err.message });
  }
});
`;

if (!serverCode.includes("/api/checkout/deduct-stock")) {
  serverCode = serverCode.replace('app.post("/api/checkout/address-save"', stockEndpoint + '\napp.post("/api/checkout/address-save"');
}

fs.writeFileSync('server.ts', serverCode);

// 2. Modify services/storage.ts
let storageCode = fs.readFileSync('services/storage.ts', 'utf-8');

const storageFix = `
    await retryRequest(async () => {
      const { error } = await supabase.from("orders").insert(payload);
      if (error) throw error;
      
      // Call new deduct-stock endpoint
      try {
        await fetch("/api/checkout/deduct-stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, items: order.items })
        });
      } catch (e) {
        console.error("Erro ao notificar baixa de estoque", e);
      }
    });
`;

storageCode = storageCode.replace(
`    await retryRequest(async () => {
      const { error } = await supabase.from("orders").insert(payload);
      if (error) throw error;
    });`,
  storageFix
);

fs.writeFileSync('services/storage.ts', storageCode);

console.log("Patched server.ts and storage.ts");
