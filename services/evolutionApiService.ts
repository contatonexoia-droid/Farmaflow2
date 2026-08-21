import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DEFAULT_EVOLUTION_URL = "https://evolution.nexoia.online";
const DEFAULT_EVOLUTION_KEY = "42964446331920a0f6707328906ed444";

export function getEvolutionConfig() {
  const rawUrl = process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_URL;
  let url = rawUrl.trim();
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  const key = (
    process.env.EVOLUTION_API_KEY ||
    process.env.EVOLUTION_GLOBAL_KEY ||
    process.env.EVOLUTION_API_TOKEN ||
    DEFAULT_EVOLUTION_KEY
  ).trim();

  return { url, key };
}

export interface SendMessageOptions {
  delay?: number;
  presence?: "composing" | "recording" | "available" | "unavailable";
  linkPreview?: boolean;
  quoted?: any;
}

export class EvolutionApiService {
  /**
   * Resolve o instanceName correto do WhatsApp, garantindo que NUNCA seja repassado um UUID para a Evolution API.
   */
  public async resolveInstanceName(
    storeIdOrTenantId: string,
    explicitInstanceName?: string
  ): Promise<string> {
    if (explicitInstanceName && explicitInstanceName.trim() && !/^[0-9a-f-]{36}$/i.test(explicitInstanceName.trim())) {
      return explicitInstanceName.trim();
    }

    const rawId = String(storeIdOrTenantId || "").trim();
    const cleanId = rawId.replace(/^store_/, "").replace(/^inbox_/, "").replace(/^tenant_/, "");

    try {
      // 1. Busca na tabela whatsapp_instances pelo store_id ou instance_name
      const { data: inst } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("instance_name, store_id")
        .or(`store_id.eq.${rawId},store_id.eq.${cleanId},store_id.eq.store_${cleanId},instance_name.eq.${rawId},instance_name.eq.${cleanId},instance_name.eq.store_${cleanId}`)
        .limit(1)
        .maybeSingle();

      if (inst?.instance_name && !/^[0-9a-f-]{36}$/i.test(inst.instance_name)) {
        return inst.instance_name;
      }
    } catch (e: any) {
      console.warn("[EvolutionApiService] Aviso ao consultar whatsapp_instances:", e.message);
    }

    try {
      // 2. Busca o slug do tenant caso o ID fornecido seja UUID
      const isUuid = /^[0-9a-f-]{36}$/i.test(cleanId) || /^[0-9a-f-]{36}$/i.test(rawId);
      if (isUuid) {
        const targetUuid = /^[0-9a-f-]{36}$/i.test(cleanId) ? cleanId : rawId;
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("slug")
          .eq("id", targetUuid)
          .maybeSingle();

        if (tenant?.slug) {
          return `store_${tenant.slug.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
        }
      }
    } catch (e: any) {
      console.warn("[EvolutionApiService] Aviso ao consultar slug do tenant:", e.message);
    }

    // 3. Fallback: formata o slug limpo
    const safeSlug = (cleanId || "default").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return `store_${safeSlug}`;
  }

  /**
   * Obtém a URL e Chave API priorizando a configuração específica da instância no banco,
   * e usando os valores globais como fallback.
   */
  public async getInstanceConfig(instanceName: string): Promise<{ url: string; key: string }> {
    const globalConfig = getEvolutionConfig();
    try {
      const { data: inst } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("evolution_url, evolution_key")
        .eq("instance_name", instanceName.trim())
        .maybeSingle();

      return {
        url: inst?.evolution_url?.trim() || globalConfig.url,
        key: inst?.evolution_key?.trim() || globalConfig.key,
      };
    } catch (e: any) {
      console.warn(`[EvolutionAPI] Erro ao buscar config da instância "${instanceName}":`, e.message);
      return globalConfig;
    }
  }

  /**
   * Envia uma mensagem de texto simples via Evolution API com tratamento completo de erros e logs
   */
  public async sendTextMessage(
    instanceName: string,
    phoneNumber: string,
    text: string,
    options?: SendMessageOptions
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    const cleanNumber = String(phoneNumber || "").replace(/\D/g, "");
    if (!cleanNumber) {
      const err = `Número de telefone inválido ou vazio: "${phoneNumber}"`;
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar mensagem para o WhatsApp: ${err}`);
      return { success: false, error: err };
    }

    if (!instanceName || instanceName.trim() === "" || /^[0-9a-f-]{36}$/i.test(instanceName.trim())) {
      const err = `Nome de instância inválido ou incompatível (UUID): "${instanceName}"`;
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar mensagem para o WhatsApp: ${err}`);
      return { success: false, error: err };
    }

    const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
    const targetUrl = `${url}/message/sendText/${instanceName.trim()}`;
    const payload = {
      number: cleanNumber,
      text: text,
      options: {
        delay: options?.delay ?? 1200,
        presence: options?.presence ?? "composing",
        linkPreview: options?.linkPreview ?? true,
        ...(options?.quoted ? { quoted: options.quoted } : {})
      }
    };

    console.log(`[EvolutionAPI] Disparando sendText para ${cleanNumber} via instância "${instanceName}" | URL: ${targetUrl}`);
    console.log(`[EvolutionAPI] Enviando requisição com apikey iniciando em: ${apiKeyToUse ? apiKeyToUse.substring(0, 6) + '...' : 'NULA/INDIFINIDA'}`);
    console.log(`[EvolutionAPI] Payload enviado:`, JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKeyToUse
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let responseJson: any = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch (_) {
        responseJson = { raw: responseText };
      }

      console.log(`[EvolutionAPI] Resposta HTTP ${response.status} da instância "${instanceName}":`, responseText);

      if (!response.ok) {
        const errorMsg = responseJson?.response?.message || responseJson?.message || responseText || `HTTP ${response.status}`;
        console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar mensagem para o WhatsApp do cliente (${cleanNumber}): HTTP ${response.status} - ${errorMsg}`);
        return {
          success: false,
          status: response.status,
          error: errorMsg,
          data: responseJson
        };
      }

      console.log(`[EvolutionAPI] ✅ Mensagem entregue com sucesso à fila da Evolution API para ${cleanNumber} (Instância: ${instanceName})`);
      return {
        success: true,
        status: response.status,
        data: responseJson
      };
    } catch (networkError: any) {
      const errorMsg = networkError?.message || String(networkError);
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Exceção de rede ao disparar mensagem para o WhatsApp do cliente (${cleanNumber}):`, errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Envia mensagem interativa CTA URL via Evolution API v2 (/message/sendInteractive/{instance})
   * Compatível com Evolution API v2.3.7+ para botões de URL/Ação.
   * Se a Evolution API retornar qualquer status diferente de 200/201 ou falhar,
   * executa obrigatoriamente o fallback imediato para sendTextMessage com link formatado.
   */
  public async sendInteractive(
    instanceName: string,
    phoneNumber: string,
    title: string,
    body: string,
    buttonText: string,
    buttonUrl: string,
    footer?: string
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number; isFallback?: boolean }> {
    const cleanNumber = String(phoneNumber || "").replace(/\D/g, "");
    if (!cleanNumber) {
      const err = `Número de telefone inválido ou vazio: "${phoneNumber}"`;
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar sendInteractive: ${err}`);
      return { success: false, error: err };
    }

    if (!instanceName || instanceName.trim() === "" || /^[0-9a-f-]{36}$/i.test(instanceName.trim())) {
      const err = `Nome de instância inválido ou incompatível (UUID): "${instanceName}"`;
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar sendInteractive: ${err}`);
      return { success: false, error: err };
    }

    const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
    const targetUrl = `${url}/message/sendInteractive/${instanceName.trim()}`;

    // Payload oficial no formato CTA URL suportado pela Evolution API v2.3.7+
    const interactivePayload = {
      number: cleanNumber,
      options: {
        type: "cta_url",
        body: body,
        footer: footer || title || "FarmaFlow",
        action: {
          display_text: buttonText || "🛒 Acessar Loja Online",
          url: buttonUrl
        }
      }
    };

    console.log(`[EvolutionAPI] Disparando sendInteractive (CTA URL) para ${cleanNumber} via instância "${instanceName}" | URL: ${targetUrl}`);
    console.log(`[EvolutionAPI] Enviando requisição com apikey iniciando em: ${apiKeyToUse ? apiKeyToUse.substring(0, 6) + '...' : 'NULA/INDEFINIDA'}`);
    console.log(`[EvolutionAPI] Payload sendInteractive:`, JSON.stringify(interactivePayload, null, 2));

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKeyToUse
        },
        body: JSON.stringify(interactivePayload)
      });

      const responseText = await response.text();
      let responseJson: any = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch (_) {
        responseJson = { raw: responseText };
      }

      console.log(`[EvolutionAPI] Resposta sendInteractive HTTP ${response.status} da instância "${instanceName}":`, responseText);

      if (response.status === 200 || response.status === 201) {
        console.log(`[EvolutionAPI] ✅ Botão interativo CTA entregue com sucesso à Evolution API para ${cleanNumber}`);
        return { success: true, status: response.status, data: responseJson };
      }

      // Se a Evolution API retornar qualquer status diferente de 200/201
      console.error(`[EvolutionAPI] Falha no sendInteractive (${response.status}). Executando fallback sendText imediato...`);
    } catch (err: any) {
      console.error(`[EvolutionAPI] Falha no sendInteractive (${err.message || err}). Executando fallback sendText imediato...`);
    }

    // Execução real e garantida do Fallback elegante (sendTextMessage)
    const fallbackFormattedText = `👋 *${title || footer || "FarmaFlow"}*\n\n${body}\n\n🛍️ *Acesse nossa Loja Online:*\n👉 ${buttonUrl}`;
    console.log(`[EvolutionAPI] Disparando fallback sendText para ${cleanNumber} com link da loja...`);

    const textFallbackResult = await this.sendTextMessage(
      instanceName,
      cleanNumber,
      fallbackFormattedText,
      { delay: 1200, linkPreview: true }
    );

    return {
      ...textFallbackResult,
      isFallback: true
    };
  }

  /**
   * Mantém retrocompatibilidade chamando sendInteractive internamente
   */
  public async sendButtons(
    instanceName: string,
    phoneNumber: string,
    title: string,
    description: string,
    buttons: Array<{ type?: string; displayText: string; url?: string; id?: string }>,
    footer?: string
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number; isFallback?: boolean }> {
    const firstUrlButton = buttons?.find(b => b.url) || buttons?.[0];
    const buttonText = firstUrlButton?.displayText || "🛒 Acessar Loja Online";
    const buttonUrl = firstUrlButton?.url || "";
    return this.sendInteractive(
      instanceName,
      phoneNumber,
      title,
      description,
      buttonText,
      buttonUrl,
      footer
    );
  }

  /**
   * Mantém retrocompatibilidade com templates de botões chamando sendInteractive internamente
   */
  public async sendTemplateButton(
    instanceName: string,
    phoneNumber: string,
    title: string,
    text: string,
    buttonText: string,
    buttonUrl: string,
    footer?: string
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number; isFallback?: boolean }> {
    return this.sendInteractive(
      instanceName,
      phoneNumber,
      title,
      text,
      buttonText,
      buttonUrl,
      footer
    );
  }
}

export const evolutionApiService = new EvolutionApiService();
