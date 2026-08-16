const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

if (!code.includes('/api/v1/chat/ai-copilot')) {
  const insertBefore = '// Endpoint para testar o agente no playground / simulador de configurações';
  const newRoute = `// Endpoint do Assistente de IA para Atendentes (Copilot de Redação no Chat)
app.post(["/api/v1/chat/ai-copilot", "/api/v1/ai/copilot"], async (req, res) => {
  try {
    const { tenantId, action, text, customInstruction } = req.body;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }
    if (!action) {
      return res.status(400).json({ error: "action é obrigatório (fix, empathy, summarize, expand, custom)." });
    }

    const result = await aiAgentService.generateCopilotAssistance(
      tenantId,
      action,
      text || "",
      customInstruction
    );

    return res.json(result);
  } catch (err: any) {
    console.error("[AI Copilot Error]:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Erro ao processar auxílio de IA para o atendente." });
  }
});

`;
  code = code.replace(insertBefore, newRoute + insertBefore);
  fs.writeFileSync('server.ts', code);
  console.log('server.ts updated with ai-copilot endpoint');
} else {
  console.log('ai-copilot endpoint already exists');
}
