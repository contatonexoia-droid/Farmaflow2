const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
`    const { error: updateError } = await updateQuery.eq('is_active', true);

    if (updateError) {
      return res.status(500).json({ error: "Erro ao atualizar heartbeat.", details: updateError.message });
    }`,
`    const { data: updateData, error: updateError } = await updateQuery.eq('is_active', true).select();

    if (updateError) {
      console.error("[HEARTBEAT ERROR]", updateError);
      return res.status(500).json({ error: "Erro ao atualizar heartbeat.", details: updateError.message });
    }
    
    if (!updateData || updateData.length === 0) {
       console.log("[HEARTBEAT WARNING] No rows updated for API key:", activeApiKey);
    } else {
       console.log("[HEARTBEAT SUCCESS] Updated for API key:", activeApiKey);
    }`
);

fs.writeFileSync('server.ts', code);
