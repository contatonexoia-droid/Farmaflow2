const fs = require('fs');

// 1. Update server.ts
let server = fs.readFileSync('server.ts', 'utf8');

const oldStatusEndpointRegex = /app\.get\("\/api\/v1\/chat\/instance\/status", requireChatEnabled, async \(req, res\) => \{[\s\S]*?\}\);/m;

const newStatusEndpoint = `app.get("/api/v1/chat/instance/status", requireChatEnabled, async (req, res) => {
    try {
        const tenantId = req.tenantId || req.query.tenantId;
        if (!tenantId) return res.status(400).json({ error: "Tenant ID is required." });
        const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\\/$/, '');
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
            await supabaseAdmin.from('whatsapp_instances').upsert({
               store_id: tenantId,
               instance_name: instanceName,
               status: 'CONNECTED',
               updated_at: new Date().toISOString()
            }, { onConflict: 'store_id' });
            return res.json({ status: 'CONNECTED' });
        } else if (connectionState === "connecting") {
            // Fetch the latest QR code
            try {
                const connectRes = await fetch(\`\${evolutionUrl}/instance/connect/\${instanceName}\`, {
                    headers: { "apikey": evolutionKey }
                });
                const connectData = await connectRes.json();
                const base64 = connectData?.qrcode?.base64 || connectData?.base64;
                if (base64) {
                    return res.json({ status: 'QRCODE', qrcodeBase64: base64 });
                }
            } catch (e) {
                console.error("Error fetching latest QR code", e);
            }
            return res.json({ status: 'QRCODE' });
        }
        return res.json({ status: 'DISCONNECTED' });
    } catch(error) {
        return res.status(500).json({ error: "Erro ao buscar status" });
    }
});`;

server = server.replace(oldStatusEndpointRegex, newStatusEndpoint);
// Also fix the trailing slash in the create endpoint just in case
server = server.replace(/const evolutionUrl = process.env.EVOLUTION_API_URL;/g, "const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\\/$/, '');");

fs.writeFileSync('server.ts', server);

// 2. Update WhatsAppConnectModal.tsx
let modal = fs.readFileSync('components/WhatsAppConnectModal.tsx', 'utf8');

const oldFetchStatusRegex = /const fetchInstanceStatus = async \(\) => \{[\s\S]*?\}\s*catch \(e\)/;
const newFetchStatus = `const fetchInstanceStatus = async () => {
    try {
      const res = await fetch(\`/api/v1/chat/instance/status?tenantId=\${tenantId}\`, {
          headers: {
              'Authorization': \`Bearer \${localStorage.getItem('farmaflow_admin_token')}\`
          }
      });
      const data = await res.json();
      if (res.ok && data.status) {
          setStatus(data.status);
          if (data.qrcodeBase64) {
              let b64 = data.qrcodeBase64;
              if (!b64.startsWith('data:image')) {
                  b64 = \`data:image/png;base64,\${b64}\`;
              }
              setQrCodeBase64(b64);
          }
      }
    } catch (e)`;

modal = modal.replace(oldFetchStatusRegex, newFetchStatus);
fs.writeFileSync('components/WhatsAppConnectModal.tsx', modal);

