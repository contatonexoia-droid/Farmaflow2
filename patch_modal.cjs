const fs = require('fs');
let content = fs.readFileSync('components/WhatsAppConnectModal.tsx', 'utf8');

const newFetchStatus = `
  const fetchInstanceStatus = async () => {
    try {
      const res = await fetch(\`/api/v1/chat/instance/status?tenantId=\${tenantId}\`, {
          headers: {
              'Authorization': \`Bearer \${localStorage.getItem('farmaflow_admin_token')}\`
          }
      });
      const data = await res.json();
      if (res.ok && data.status) {
          setStatus(data.status);
      }
    } catch (e) {
        console.error("Erro ao checar status", e);
    }
  };
`;

const newGenerateQR = `
  const handleGenerateQRCode = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/chat/instance/create', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': \`Bearer \${localStorage.getItem('farmaflow_admin_token')}\`
          },
          body: JSON.stringify({ tenantId })
      });
      const data = await res.json();
      if (res.ok && data.qrcodeBase64) {
          // If Evolution API returns the base64 without prefix
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
              b64 = \`data:image/png;base64,\${b64}\`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
          setIsPolling(true);
      } else {
          alert(data.error || "Erro ao gerar QR Code. Verifique as configurações da API.");
      }
    } catch (e) {
        console.error("Erro ao gerar QR Code", e);
        alert("Erro de conexão ao gerar QR Code.");
    } finally {
        setIsLoading(false);
    }
  };
`;

content = content.replace(/const fetchInstanceStatus = async \(\) => {[\s\S]*?};/, newFetchStatus);
content = content.replace(/const handleGenerateQRCode = async \(\) => {[\s\S]*?};/, newGenerateQR);

fs.writeFileSync('components/WhatsAppConnectModal.tsx', content);
