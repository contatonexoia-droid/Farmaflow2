const fs = require('fs');
let code = fs.readFileSync('services/aiAgentService.ts', 'utf8');

if (!code.includes('generateCopilotAssistance')) {
  const insertBefore = '  private async callGemini(';
  const copilotMethod = `  /**
   * Assistente de IA para Atendentes (Copilot interno de redação no chat)
   */
  public async generateCopilotAssistance(
    tenantId: string,
    action: 'fix' | 'empathy' | 'summarize' | 'expand' | 'custom',
    text: string,
    customInstruction?: string
  ): Promise<{ suggestedText: string; action: string }> {
    if (!text && action !== 'expand') {
      throw new Error("Texto base é obrigatório para processamento da IA.");
    }

    // 1. Validar autorização do tenant no Super Admin
    let tenant: any = null;
    const { data: tenantData } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .or(\`id.eq.\${tenantId},slug.eq.\${tenantId}\`)
      .maybeSingle();

    if (tenantData) {
      tenant = tenantData;
    } else {
      const { data: fallbackTenant } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .maybeSingle();
      tenant = fallbackTenant;
    }

    if (!tenant) {
      throw new Error(\`Drogaria não encontrada (\${tenantId}).\`);
    }

    const isCopilotAllowed = 
      tenant.is_ai_copilot_enabled === true || 
      tenant.is_ai_agent_enabled === true ||
      tenant.isaiagentenabled === true;

    if (!isCopilotAllowed) {
      const err = new Error("MÓDULO_NÃO_AUTORIZADO: O Assistente de IA para Atendentes não está liberado no plano desta drogaria. Solicite liberação no Super Admin.");
      (err as any).statusCode = 403;
      throw err;
    }

    const pharmacyName = tenant.name || "Nossa Farmácia";
    let effectiveConfig: AiAgentConfig = {
      enabled: true,
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash'
    };

    if (tenant.ai_agent_config) {
      try {
        effectiveConfig = typeof tenant.ai_agent_config === 'string'
          ? JSON.parse(tenant.ai_agent_config)
          : tenant.ai_agent_config;
      } catch (e) {}
    }

    const provider = effectiveConfig.provider || 'gemini';
    const apiKey = effectiveConfig.apiKey?.trim() || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

    if (!apiKey) {
      throw new Error("Chave de API de IA não configurada no servidor ou na drogaria.");
    }

    // Definir prompt com base na ação
    let taskInstruction = "";
    switch (action) {
      case 'fix':
        taskInstruction = "Sua tarefa é CORRIGIR a ortografia, pontuação, acentuação e concordância gramatical da mensagem abaixo. Mantenha o sentido, o tom original e os termos técnicos farmacêuticos ou nomes comerciais de medicamentos intactos. Retorne APENAS o texto corrigido, sem explicações ou introduções.";
        break;
      case 'empathy':
        taskInstruction = \`Sua tarefa é REESCREVER a mensagem para torná-la altamente acolhedora, empática, profissional e humanizada, adequada para o atendimento de balcão da farmácia "\${pharmacyName}". Transmita cuidado genuíno com a saúde e bem-estar do cliente, com linguagem clara e calorosa. Retorne APENAS o texto aprimorado, sem explicações.\`;
        break;
      case 'summarize':
        taskInstruction = "Sua tarefa é RESUMIR e tornar a mensagem o mais DIRETA, clara e concisa possível para leitura rápida no WhatsApp, mantendo todas as informações essenciais (preços, orientações, prazos). Retorne APENAS o texto resumido.";
        break;
      case 'expand':
        taskInstruction = \`Sua tarefa é CRIAR uma mensagem de WhatsApp completa, profissional, educada e pronta para envio pelo atendente da farmácia "\${pharmacyName}", a partir das anotações/tópicos soltos fornecidos. Seja atencioso, claro e bem estruturado com quebras de linha confortáveis. Retorne APENAS a mensagem pronta para envio.\`;
        break;
      case 'custom':
        taskInstruction = \`Sua tarefa é reescrever ou ajustar a mensagem de atendimento da farmácia "\${pharmacyName}" seguindo estritamente esta instrução: "\${customInstruction || 'Aprimorar a mensagem'}". Retorne APENAS o texto final pronto para envio.\`;
        break;
    }

    const systemPrompt = \`Você é o Copilot Especialista em Comunicação Farmacêutica da farmácia "\${pharmacyName}".
Você auxilia atendentes humanos a redigirem mensagens perfeitas para clientes no WhatsApp.
REGRAS OBRIGATÓRIAS:
- Retorne SEMPRE E APENAS o texto final pronto para ser colado no WhatsApp.
- NUNCA inclua frases de introdução como "Aqui está a mensagem:", "Sugestão:", aspas extras ou comentários.
- Preserve números de telefone, links, valores em R$ e nomes de produtos/medicamentos informados.
\${taskInstruction}\`;

    const incomingMessage = text || (customInstruction || "Olá");
    let resultText = "";

    if (provider === 'openai') {
      const res = await this.callOpenAi(apiKey, effectiveConfig.model || 'gpt-4o-mini', systemPrompt, incomingMessage, [], '');
      resultText = res.reply;
    } else {
      const res = await this.callGemini(apiKey, effectiveConfig.model || 'gemini-2.5-flash', systemPrompt, incomingMessage, [], '');
      resultText = res.reply;
    }

    return {
      suggestedText: resultText.replace(/^["']|["']$/g, '').trim(),
      action
    };
  }

`;
  code = code.replace(insertBefore, copilotMethod + insertBefore);
  fs.writeFileSync('services/aiAgentService.ts', code);
  console.log('aiAgentService.ts updated with generateCopilotAssistance');
} else {
  console.log('generateCopilotAssistance already exists');
}
