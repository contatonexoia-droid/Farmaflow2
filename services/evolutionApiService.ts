import { createClient } from "@supabase/supabase-js";
import { ensureStoreUrlCacheBuster } from "./aiAgentService.js";

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
    storeIdOrTenantId: string = "",
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
   * Envia uma mensagem de texto simples via Evolution API com tratamento completo de erros e logs.
   * Suporta chamada posicional (instanceName, phone, text, options) ou com objeto ({ number, text, linkPreview, ... }).
   */
  public async sendTextMessage(
    firstParam: string | {
      instanceName?: string;
      number?: string;
      phoneNumber?: string;
      text: string;
      options?: SendMessageOptions;
      linkPreview?: boolean;
      delay?: number;
      presence?: "composing" | "recording" | "available" | "unavailable";
      quoted?: any;
    },
    secondParam?: string,
    thirdParam?: string,
    fourthParam?: SendMessageOptions
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    let instanceName: string;
    let phoneNumber: string;
    let text: string;
    let options: SendMessageOptions | undefined;

    if (typeof firstParam === "object" && firstParam !== null) {
      instanceName = String(firstParam.instanceName || "").trim();
      phoneNumber = String(firstParam.number || firstParam.phoneNumber || "").trim();
      text = String(firstParam.text || "");
      options = {
        delay: firstParam.delay,
        presence: firstParam.presence,
        linkPreview: firstParam.linkPreview,
        quoted: firstParam.quoted,
        ...(firstParam.options || {})
      };
      if (!instanceName) {
        instanceName = (await this.resolveInstanceName()) || "";
      }
    } else {
      instanceName = String(firstParam || "").trim();
      phoneNumber = String(secondParam || "").trim();
      text = String(thirdParam || "");
      options = fourthParam;
    }

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

    const hasLink = /(https?:\/\/[^\s]+)/i.test(text);
    const isPureUrl = /^\s*https?:\/\/[^\s]+\s*$/i.test(text.trim());
    const wantsLinkPreview = options?.linkPreview !== false;
    const shouldEnableLinkPreview = wantsLinkPreview && hasLink;

    // Quando há link (especialmente URL pura isolada em seu próprio balão),
    // garantimos tempo de resolução suficiente para a Evolution API / Baileys
    // resolver o DNS, buscar as tags Open Graph (og:image) e renderizar a miniatura (thumbnail) do WhatsApp
    const defaultDelay = isPureUrl ? 2000 : (shouldEnableLinkPreview ? 2500 : 1200);
    const effectiveDelay = options?.delay !== undefined 
      ? Math.max(options.delay, isPureUrl ? 1500 : (shouldEnableLinkPreview ? 2000 : 800)) 
      : defaultDelay;

    const payload: any = {
      number: cleanNumber,
      text: text,
      linkPreview: shouldEnableLinkPreview,
      link_preview: shouldEnableLinkPreview,
      options: {
        delay: effectiveDelay,
        presence: options?.presence ?? "composing",
        linkPreview: shouldEnableLinkPreview,
        link_preview: shouldEnableLinkPreview,
        ...(options?.quoted ? { quoted: options.quoted } : {})
      }
    };

    console.log(`[EvolutionAPI] Disparando sendText para ${cleanNumber} via instância "${instanceName}" (linkPreview: ${shouldEnableLinkPreview}, delay: ${effectiveDelay}ms) | URL: ${targetUrl}`);
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
   * Envia evento de presença (digitando/composing, gravando áudio, etc.) para o WhatsApp via Evolution API
   */
  public async sendPresence(
    instanceName: string,
    phoneNumber: string,
    presence: "composing" | "recording" | "available" | "unavailable" = "composing",
    delay: number = 1200
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const cleanNumber = String(phoneNumber || "").replace(/\D/g, "");
    if (!cleanNumber) {
      return { success: false, error: "Número inválido" };
    }

    if (!instanceName || instanceName.trim() === "" || /^[0-9a-f-]{36}$/i.test(instanceName.trim())) {
      return { success: false, error: "Instância inválida" };
    }

    try {
      const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
      const targetUrl = `${url}/chat/sendPresence/${instanceName.trim()}`;
      const payload = {
        number: cleanNumber,
        presence: presence,
        delay: delay
      };

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKeyToUse
        },
        body: JSON.stringify(payload)
      });

      return { success: response.ok };
    } catch (networkError: any) {
      console.warn(`[EvolutionAPI] Aviso ao enviar presença (${presence}) para ${cleanNumber}:`, networkError.message);
      return { success: false, error: networkError.message };
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

    // Execução real e garantida do Fallback elegante em 2 balões separados
    const balloon1Text = `👋 *${title || footer || "FarmaFlow"}*\n\n${body}`;
    console.log(`[EvolutionAPI] Disparando fallback Balão 1 (Texto Principal) para ${cleanNumber}...`);
    const balloon1Result = await this.sendTextMessage(
      instanceName,
      cleanNumber,
      balloon1Text,
      { delay: 1000, linkPreview: false }
    );

    if (!balloon1Result.success) {
      return { ...balloon1Result, isFallback: true };
    }

    // Delay de 1200ms para ordenação visual no WhatsApp
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Balão 2: EXCLUSIVAMENTE a URL pura com cache-buster (gera preview perfeito com logo oficial)
    const freshUrl = ensureStoreUrlCacheBuster(buttonUrl);
    console.log(`[EvolutionAPI] Disparando fallback Balão 2 (URL Pura com Cache-Buster) para ${cleanNumber}: ${freshUrl}`);
    const balloon2Result = await this.sendTextMessage(
      instanceName,
      cleanNumber,
      freshUrl,
      { delay: 1500, linkPreview: true }
    );

    return {
      ...balloon2Result,
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

  /**
   * Envia uma mensagem de áudio nativa no WhatsApp (Push-to-Talk / gravação de voz)
   * através da Evolution API (/message/sendWhatsAppAudio).
   */
  public async sendWhatsAppAudio(
    firstParam: string | {
      instanceName?: string;
      number?: string;
      phoneNumber?: string;
      audio: string;
      ptt?: boolean;
      delay?: number;
      encoding?: boolean;
    },
    secondParam?: string,
    thirdParam?: string,
    fourthParam?: { ptt?: boolean; delay?: number; encoding?: boolean }
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    let instanceName: string;
    let phoneNumber: string;
    let audio: string;
    let options: { ptt?: boolean; delay?: number; encoding?: boolean } = {};

    if (typeof firstParam === "object" && firstParam !== null) {
      instanceName = (firstParam.instanceName || "").trim();
      phoneNumber = String(firstParam.number || firstParam.phoneNumber || "");
      audio = firstParam.audio;
      options = {
        ptt: firstParam.ptt !== false,
        delay: firstParam.delay || 1200,
        encoding: firstParam.encoding !== false
      };
    } else {
      instanceName = (typeof firstParam === "string" ? firstParam : "").trim();
      phoneNumber = String(secondParam || "");
      audio = String(thirdParam || "");
      options = {
        ptt: fourthParam?.ptt !== false,
        delay: fourthParam?.delay || 1200,
        encoding: fourthParam?.encoding !== false
      };
    }

    const cleanNumber = phoneNumber.replace(/\D/g, "");
    if (!instanceName || !cleanNumber || !audio) {
      const err = `Parâmetros inválidos para sendWhatsAppAudio: instance="${instanceName}", number="${cleanNumber}", audioPresent=${Boolean(audio)}`;
      console.error(`[EvolutionAPI] ${err}`);
      return { success: false, error: err };
    }

    const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
    const cleanInstance = instanceName.trim();

    const payload = {
      number: cleanNumber,
      audio: audio,
      delay: options.delay || 1200,
      encoding: true,
      ptt: options.ptt !== false
    };

    console.log(`[EvolutionAPI] 🎙️ Disparando sendWhatsAppAudio (PTT: ${options.ptt !== false}) para ${cleanNumber} via instância "${cleanInstance}" | Tamanho áudio: ${audio.length} chars`);

    const endpoints = [
      `${url}/message/sendWhatsAppAudio/${cleanInstance}`,
      `${url}/chat/sendWhatsAppAudio/${cleanInstance}`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
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

        if (response.status === 200 || response.status === 201) {
          console.log(`[EvolutionAPI] ✅ Áudio WhatsApp (PTT) entregue com sucesso à Evolution API para ${cleanNumber}`);
          return { success: true, status: response.status, data: responseJson };
        }
        console.warn(`[EvolutionAPI] Endpoint ${endpoint} retornou status ${response.status}:`, responseText);
      } catch (err: any) {
        console.warn(`[EvolutionAPI] Falha ao tentar endpoint ${endpoint}:`, err.message);
      }
    }

    return { success: false, error: "Falha ao enviar áudio em todos os endpoints da Evolution API" };
  }

  /**
   * Baixa a mídia da mensagem em Base64 através da Evolution API v2 (/chat/getBase64FromMediaMessage)
   * e garante o retorno de uma Data URI completa e válida (data:mime;base64,...)
   */
  public async getBase64FromMediaMessage(
    instanceName: string,
    message: any
  ): Promise<string | null> {
    if (!instanceName || !message) return null;
    try {
      const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
      const cleanInstance = instanceName.trim();
      
      // Detecta mimetype da mensagem original se disponível
      const rawMsg = message.message || message.data?.message || message.data || {};
      const detectedMime = 
        rawMsg.imageMessage?.mimetype || 
        rawMsg.audioMessage?.mimetype || 
        rawMsg.videoMessage?.mimetype || 
        rawMsg.documentMessage?.mimetype || 
        rawMsg.stickerMessage?.mimetype || 
        message.mimetype || 
        (message.messageType === "audioMessage" ? "audio/ogg; codecs=opus" : 
         message.messageType === "imageMessage" ? "image/jpeg" : 
         message.messageType === "videoMessage" ? "video/mp4" : "image/jpeg");

      const isAudioMsg = 
        message.messageType === "audioMessage" ||
        message.messageType === "ptt" ||
        message.messageType === "audio" ||
        Boolean(rawMsg.audioMessage) ||
        String(detectedMime).startsWith("audio/");

      if (isAudioMsg) {
        console.log('[AUDIO_DEBUG] Tentando obter base64 da mensagem...', message.key?.id || message.id);
      }

      // Se já veio base64 direto na mensagem
      const directBase64 = 
        message.base64 ||
        rawMsg.audioMessage?.base64 ||
        rawMsg.imageMessage?.base64 ||
        rawMsg.documentMessage?.base64 ||
        message.data?.base64;

      if (directBase64 && typeof directBase64 === "string" && directBase64.length > 50) {
        if (directBase64.startsWith("data:")) {
          if (isAudioMsg) console.log('[AUDIO_DEBUG] Base64 obtido com sucesso? Tam:', directBase64.length);
          return directBase64;
        }
        const cleanBase64 = directBase64.replace(/\s/g, '');
        if (isAudioMsg) console.log('[AUDIO_DEBUG] Base64 obtido com sucesso? Tam:', cleanBase64.length);
        return `data:${detectedMime};base64,${cleanBase64}`;
      }

      // Formas de payload suportadas pela Evolution API v2
      const rawKey = message.key || message.data?.key || message.message?.key || {};
      const rawMessageContent = message.message || message.data?.message || message;

      const messagePayload = {
        message: {
          key: rawKey,
          message: rawMessageContent
        },
        convertToMp3: true
      };

      const payloadsToTry = [
        messagePayload,
        {
          message: message,
          convertToMp3: true,
          convertToMp4: false
        },
        {
          message: {
            key: rawKey,
            message: rawMessageContent
          }
        },
        {
          message: message
        }
      ];

      const endpoints = [
        `${url}/chat/getBase64FromMediaMessage/${cleanInstance}`,
        `${url}/message/getBase64FromMediaMessage/${cleanInstance}`
      ];

      for (const endpoint of endpoints) {
        for (const payload of payloadsToTry) {
          try {
            console.log(`[AUDIO_DEBUG] Chamando Evolution API (${endpoint}) para obter mídia...`);
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": apiKeyToUse
              },
              body: JSON.stringify(payload)
            });

            if (res.ok) {
              const data = await res.json();
              let rawBase64 = data.base64 || data.data?.base64 || (typeof data.data === "string" && data.data.length > 50 ? data.data : null) || data.url;
              const returnedMime = data.mimetype || data.data?.mimetype || detectedMime;

              if (rawBase64 && typeof rawBase64 === "string") {
                if (isAudioMsg) {
                  console.log('[AUDIO_DEBUG] Base64 obtido com sucesso? Tam:', rawBase64.length);
                }
                // Se já for uma Data URI completa
                if (rawBase64.startsWith("data:")) {
                  return rawBase64;
                }
                
                // Se for base64 puro, limpa espaços/newlines e monta a Data URI completa
                const cleanBase64 = rawBase64.replace(/\s/g, '');
                return `data:${returnedMime};base64,${cleanBase64}`;
              } else {
                console.warn(`[AUDIO_DEBUG] Evolution API retornou status 200 no endpoint ${endpoint}, mas sem base64 válido:`, JSON.stringify(data));
              }
            } else {
              const errText = await res.text();
              console.error(`[AUDIO_DEBUG] Evolution API retornou status ${res.status} no endpoint ${endpoint}:`, errText);
            }
          } catch (fetchErr: any) {
            console.error(`[AUDIO_DEBUG] Falha de conexão ao chamar Evolution API (${endpoint}):`, fetchErr?.message || fetchErr);
          }
        }
      }
    } catch (e: any) {
      console.warn("[EvolutionAPI] Erro ao buscar base64 da mídia:", e.message);
    }
    return null;
  }

  /**
   * Envia uma reação (emoji) ou remove uma reação para uma mensagem específica no WhatsApp via Evolution API.
   * Endpoint oficial: POST /message/sendReaction/{instance}
   */
  public async sendReaction(
    instanceName: string,
    key: { remoteJid: string; id: string; fromMe?: boolean },
    emoji: string
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    if (!instanceName || instanceName.trim() === "" || /^[0-9a-f-]{36}$/i.test(instanceName.trim())) {
      const err = `Nome de instância inválido ou incompatível (UUID): "${instanceName}"`;
      console.error(`[EvolutionAPI] [ERRO EVOLUTION] Falha ao disparar sendReaction: ${err}`);
      return { success: false, error: err };
    }

    const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
    const cleanInstance = instanceName.trim();
    const cleanJid = key.remoteJid.includes("@") ? key.remoteJid : `${key.remoteJid.replace(/\D/g, "")}@s.whatsapp.net`;

    const payload = {
      key: {
        remoteJid: cleanJid,
        fromMe: Boolean(key.fromMe),
        id: key.id
      },
      reaction: emoji || "" // emoji vazio remove a reação no WhatsApp
    };

    console.log(`[EvolutionAPI] Enviando reação "${emoji || '(remover)'}" para msg ${key.id} (${cleanJid}) via ${cleanInstance}...`);

    const endpoints = [
      `${url}/message/sendReaction/${cleanInstance}`,
      `${url}/chat/sendReaction/${cleanInstance}`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
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

        if (response.ok) {
          console.log(`[EvolutionAPI] ✅ Reação "${emoji}" enviada com sucesso para msg ${key.id}`);
          return { success: true, status: response.status, data: responseJson };
        }
      } catch (err: any) {
        console.warn(`[EvolutionAPI] Falha no endpoint ${endpoint}:`, err.message);
      }
    }

    return { success: false, error: "Falha ao enviar reação nos endpoints da Evolution API" };
  }
}

export const evolutionApiService = new EvolutionApiService();
