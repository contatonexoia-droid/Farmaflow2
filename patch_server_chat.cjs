const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const middlewareBlock = `// MÓDULO FARMAFLOW CHAT - ROTAS DE BACKEND
// =========================================

// Middleware para verificar se o chat está ativado
const requireChatEnabled = async (req, res, next) => {
  try {
    let tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Se não tiver o header direto, tenta extrair da conversa ou instancia dependendo da rota
    if (!tenantId && req.body.conversation_id) {
       const { data: conv } = await supabaseAdmin.from('chat_conversations').select('store_id').eq('id', req.body.conversation_id).single();
       if (conv) tenantId = conv.store_id;
    }
    
    // Em caso de webhook de provedor externo (Evolution API), a instancia geralmente contém ou mapeia o tenantId
    if (!tenantId && req.body?.data?.instance) {
       const { data: inst } = await supabaseAdmin.from('whatsapp_instances').select('store_id').eq('instance_name', req.body.data.instance).single();
       if (inst) tenantId = inst.store_id;
    }

    if (tenantId) {
       const { data: tenant } = await supabaseAdmin.from('tenants').select('is_chat_enabled').eq('id', tenantId).single();
       if (tenant && tenant.is_chat_enabled === false) {
          return res.status(403).json({ error: "Módulo de Chat desativado para esta loja." });
       }
    }
    
    next();
  } catch (error) {
    console.error("[Chat Middleware] Erro ao validar licença:", error);
    next(); // Falha aberta para não quebrar em caso de instabilidade
  }
};
`;

content = content.replace('// MÓDULO FARMAFLOW CHAT - ROTAS DE BACKEND\n// =========================================', middlewareBlock);

// Replace app.post("/api/v1/chat/webhook", async (req, res) => { with app.post("/api/v1/chat/webhook", requireChatEnabled, async (req, res) => {
content = content.replace(
  'app.post("/api/v1/chat/webhook", async (req, res) => {',
  'app.post("/api/v1/chat/webhook", requireChatEnabled, async (req, res) => {'
);

// Replace app.post("/api/v1/chat/send", async (req, res) => { with app.post("/api/v1/chat/send", requireChatEnabled, async (req, res) => {
content = content.replace(
  'app.post("/api/v1/chat/send", async (req, res) => {',
  'app.post("/api/v1/chat/send", requireChatEnabled, async (req, res) => {'
);

fs.writeFileSync('server.ts', content);
