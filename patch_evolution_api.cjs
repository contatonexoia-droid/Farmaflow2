const fs = require('fs');
let serverContent = fs.readFileSync('server.ts', 'utf8');

const endpoints = `
// --- EVOLUTION API WHATSAPP INSTANCE ENDPOINTS ---

app.post("/api/v1/chat/instance/create", requireChatEnabled, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.body.tenantId;
    if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

    const evolutionUrl = process.env.EVOLUTION_API_URL;
    const evolutionKey = process.env.EVOLUTION_API_KEY;

    if (!evolutionUrl || !evolutionKey) {
      return res.status(500).json({ error: "A API do WhatsApp (Evolution API) não está configurada no servidor. Faltam credenciais (EVOLUTION_API_URL e EVOLUTION_API_KEY)." });
    }

    const instanceName = \`farmaflow-\${tenantId}\`;

    // 1. Criar a instância
    const createRes = await fetch(\`\${evolutionUrl}/instance/create\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionKey
      },
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS"
      })
    });

    const createData = await createRes.json();
    
    // Verifica se já existe ou retornou o base64
    let base64 = createData?.qrcode?.base64 || createData?.base64;

    if (!base64 && createRes.status === 403 && createData?.message?.includes("already exists")) {
        // Se já existe, tenta buscar o QR code conectando
        const connectRes = await fetch(\`\${evolutionUrl}/instance/connect/\${instanceName}\`, {
            headers: { "apikey": evolutionKey }
        });
        const connectData = await connectRes.json();
        base64 = connectData?.base64;
    }

    if (base64) {
      // Salva ou atualiza no banco
      await supabaseAdmin.from('whatsapp_instances').upsert({
         store_id: tenantId,
         instance_name: instanceName,
         status: 'QRCODE',
         updated_at: new Date().toISOString()
      }, { onConflict: 'store_id' });

      return res.json({ success: true, qrcodeBase64: base64 });
    } else {
      return res.status(500).json({ error: "Não foi possível gerar o QR Code. A instância pode já estar conectada." });
    }

  } catch (error: any) {
    console.error("Erro ao criar instância Evolution API:", error);
    res.status(500).json({ error: error.message || "Erro interno ao gerar QR Code" });
  }
});

app.get("/api/v1/chat/instance/status", requireChatEnabled, async (req, res) => {
    try {
        const tenantId = req.tenantId || req.query.tenantId;
        if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });

        const evolutionUrl = process.env.EVOLUTION_API_URL;
        const evolutionKey = process.env.EVOLUTION_API_KEY;
    
        if (!evolutionUrl || !evolutionKey) {
            return res.status(500).json({ error: "A API do WhatsApp não está configurada." });
        }

        const instanceName = \`farmaflow-\${tenantId}\`;

        const stateRes = await fetch(\`\${evolutionUrl}/instance/connectionState/\${instanceName}\`, {
            headers: { "apikey": evolutionKey }
        });
        
        if (stateRes.status === 404) {
            return res.json({ status: 'DISCONNECTED' });
        }

        const stateData = await stateRes.json();
        const connectionState = stateData?.instance?.state || stateData?.state;

        if (connectionState === "open") {
            // Atualiza status no banco
            await supabaseAdmin.from('whatsapp_instances').upsert({
               store_id: tenantId,
               instance_name: instanceName,
               status: 'CONNECTED',
               updated_at: new Date().toISOString()
            }, { onConflict: 'store_id' });

            return res.json({ status: 'CONNECTED' });
        } else if (connectionState === "connecting") {
            return res.json({ status: 'QRCODE' });
        }

        return res.json({ status: 'DISCONNECTED' });

    } catch(error) {
        return res.status(500).json({ error: "Erro ao buscar status" });
    }
});

// 1. Webhook para Evolution API
`;

serverContent = serverContent.replace('// 1. Webhook para Evolution API\n', endpoints);
fs.writeFileSync('server.ts', serverContent);
