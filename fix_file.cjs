const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
const startTag = 'app.get("/api/v1/agent/download/:erpType"';
const nextTag = 'app.post("/api/v1/integration/heartbeat"';
const startIndex = code.indexOf(startTag);
const nextIndex = code.indexOf(nextTag);
if (startIndex === -1 || nextIndex === -1) {
    console.log("Could not find boundaries");
    console.log("start:", startIndex);
    console.log("next:", nextIndex);
    process.exit(1);
}

const replacement = `app.get("/api/v1/agent/download/:erpType", (req, res) => {
  try {
    const { erpType } = req.params;
    let fileName = "farmaflow-agent.zip";
    if (erpType === "siagold") {
      fileName = "farmaflow-siagold.zip";
    } else if (erpType === "softpharma") {
      fileName = "farmaflow-softpharma.zip";
    }

    // Redirect to static file path for Vercel/CDN compatibility
    return res.redirect(302, \`/installers/\${fileName}\`);
  } catch (err: any) {
    console.error("[Agent Download] Erro interno no manipulador de download do agente:", err);
    return res.status(500).json({ error: "Erro interno ao processar o download do agente." });
  }
});

app.post("/api/v1/integration/validate-token", async (req, res) => {
  console.log(\`\\n[SERVER BACKEND] Recebida requisição de validação em /api/v1/integration/validate-token\`);
  try {
    const { token, machineId } = req.body;
    console.log(\`- Token recebido: "\${token ? token.substring(0, 8) + '...' : 'não fornecido'}"\`);
    console.log(\`- Machine ID: "\${machineId || 'não fornecido'}"\`);

    if (!token) {
      console.warn(\`[SERVER BACKEND] Validação recusada: Token não fornecido (400 Bad Request)\`);
      return res.status(400).json({ error: "Token não fornecido" });
    }

    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from('activation_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (fetchError || !tokenData) {
      console.warn(\`[SERVER BACKEND] Validação recusada: Token não encontrado no Supabase (404 Not Found)\`);
      return res.status(404).json({ error: "Token inválido, inativo ou não encontrado." });
    }

    console.log(\`- Marcando token como utilizado...\`);
    await supabaseAdmin
      .from('activation_tokens')
      .update({ is_used: true })
      .eq('id', tokenData.id);

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('erp_type')
      .eq('id', tokenData.tenant_id)
      .single();
      
    const erpType = tenant?.erp_type || 'siagold';

    console.log(\`[SERVER BACKEND] Token validado com sucesso! Tenant ERP: \${erpType}\`);

    res.json({
      erpType: erpType.toLowerCase(),
      dbConfig: {
        user: "sa", // Placeholder
        password: "sua_senha_aqui",
        server: "localhost",
        database: "SIAGOLD",
        branchCode: "1",
        viewName: 'VW_INTEGRACAO_FARMAFLOW'
      },
      apiKey: tokenData.tenant_id
    });
  } catch (error: any) {
    console.error(\`[SERVER BACKEND] Erro interno durante validação do token (500):\`, error.message);
    res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

`;

const newCode = code.substring(0, startIndex) + replacement + code.substring(nextIndex);
fs.writeFileSync('server.ts', newCode);
console.log("Success!");
