const fs = require('fs');
let code = fs.readFileSync('services/storage.ts', 'utf8');

const oldCode = `    // CORREÇÃO: Salvamento em lotes (Chunks) para evitar AbortError / Timeout em grandes cargas
    const CHUNK_SIZE = 50;
    for (let i = 0; i < dbProducts.length; i += CHUNK_SIZE) {
      const chunk = dbProducts.slice(i, i + CHUNK_SIZE);
      
      await retryRequest(async () => {
        const { error } = await supabase
          .from("products")
          .upsert(chunk);
        if (error) throw error;
      });
    }`;

const newCode = `    // Use the backend API to bypass RLS issues for product updates
    await retryRequest(async () => {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(\`/api/v1/tenants/\${tenantId}/products/bulk\`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': \`Bearer \${token}\`
            },
            body: JSON.stringify({ products: dbProducts })
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to save products");
        }
    });`;

if (code.includes('const CHUNK_SIZE = 50;')) {
    code = code.replace(oldCode, newCode);
    fs.writeFileSync('services/storage.ts', code);
    console.log('Fixed storage.ts to use API');
} else {
    console.log('Could not find chunk insertion logic');
}
