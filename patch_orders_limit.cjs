const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = `      .eq("tenant_id", id)
      .order("created_at", { ascending: false });`;
const newStr = `      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(200); // OTMIZACAO: Limita a 200 ultimos pedidos no dashboard inicial`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('server.ts', code);
