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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value?: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function isExclusiveInstanceName(name?: unknown): boolean {
  const n = String(name || "").trim().toLowerCase();
  return n.startsWith("inbox_ex_") || n.includes("_excl");
}

export interface ResolvedConnectedInstance {
  id: string;
  instance_name: string;
  store_id: string;
  phone_number?: string | null;
  status: string;
  source: "inbox" | "explicit" | "store_fallback";
}

/**
 * Resolve o conjunto de identificadores possíveis de store_id para uma loja,
 * sempre consultando public.tenants por `id` primeiro (com fallback para `slug`, nunca apenas `slug`).
 */
export async function resolveStoreCandidateIds(rawStoreId?: string | null): Promise<string[]> {
  const raw = String(rawStoreId || "").trim();
  if (!raw) return [];

  const clean = raw.replace(/^store_/, "").replace(/^tenant_/, "").trim();
  const dash = clean.replace(/_/g, "-");
  const candidates = new Set<string>([raw, clean, dash, `store_${clean}`].filter(Boolean));

  try {
    // 1. Busca prioritária por tenants.id
    const { data: byId } = await supabaseAdmin
      .from("tenants")
      .select("id, slug")
      .in("id", Array.from(candidates))
      .limit(1)
      .maybeSingle();

    if (byId?.id) {
      candidates.add(String(byId.id).trim());
      if (byId.slug) candidates.add(String(byId.slug).trim());
    } else {
      // 2. Fallback por tenants.slug
      const { data: bySlug } = await supabaseAdmin
        .from("tenants")
        .select("id, slug")
        .in("slug", Array.from(candidates))
        .limit(1)
        .maybeSingle();

      if (bySlug?.id) {
        candidates.add(String(bySlug.id).trim());
        if (bySlug.slug) candidates.add(String(bySlug.slug).trim());
      }
    }
  } catch (_) {
    // Mantém os candidatos já coletados em caso de erro de rede
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Atualiza um registro em public.whatsapp_instances limpando AMBAS as colunas
 * qr_code_base64 e qrcode_base64 quando clearQrCodes=true, com fallback resiliente
 * caso alguma das colunas não exista no schema atual do Supabase.
 */
export async function safeUpdateWhatsappInstance(
  matchColumn: "id" | "instance_name",
  matchValue: string,
  payload: Record<string, any>,
  clearQrCodes = false
): Promise<{ data: any; error: any }> {
  const basePayload: Record<string, any> = {
    ...payload,
    updated_at: payload.updated_at || new Date().toISOString(),
  };

  if (!clearQrCodes) {
    return supabaseAdmin
      .from("whatsapp_instances")
      .update(basePayload)
      .eq(matchColumn, matchValue)
      .select("id, store_id, instance_name, status, phone_number")
      .maybeSingle();
  }

  // Tenta limpar ambas as colunas (qr_code_base64 e qrcode_base64)
  const bothPayload = { ...basePayload, qrcode_base64: null, qr_code_base64: null };
  const firstAttempt = await supabaseAdmin
    .from("whatsapp_instances")
    .update(bothPayload)
    .eq(matchColumn, matchValue)
    .select("id, store_id, instance_name, status, phone_number")
    .maybeSingle();

  if (!firstAttempt.error) {
    return firstAttempt;
  }

  const errMsg = String(firstAttempt.error?.message || "").toLowerCase();
  const isMissingCol =
    firstAttempt.error?.code === "42703" ||
    firstAttempt.error?.code === "PGRST204" ||
    errMsg.includes("column") ||
    errMsg.includes("schema cache");

  if (!isMissingCol) {
    return firstAttempt;
  }

  // Fallback: remove a coluna inexistente mantendo a outra limpa
  if (errMsg.includes("qr_code_base64")) {
    const retry1 = await supabaseAdmin
      .from("whatsapp_instances")
      .update({ ...basePayload, qrcode_base64: null })
      .eq(matchColumn, matchValue)
      .select("id, store_id, instance_name, status, phone_number")
      .maybeSingle();
    if (!retry1.error) return retry1;
  } else if (errMsg.includes("qrcode_base64")) {
    const retry2 = await supabaseAdmin
      .from("whatsapp_instances")
      .update({ ...basePayload, qr_code_base64: null })
      .eq(matchColumn, matchValue)
      .select("id, store_id, instance_name, status, phone_number")
      .maybeSingle();
    if (!retry2.error) return retry2;
  }

  // Fallback final sem campos de QR caso nenhum exista
  return supabaseAdmin
    .from("whatsapp_instances")
    .update(basePayload)
    .eq(matchColumn, matchValue)
    .select("id, store_id, instance_name, status, phone_number")
    .maybeSingle();
}

/**
 * Sincroniza automaticamente public.inboxes.whatsapp_instance_id para a instância CONNECTED
 * da loja, curando vínculos órfãos/antigos ou nulos enquanto preserva caixas explicitamente
 * vinculadas a OUTRA instância exclusiva CONNECTED.
 */
export async function syncStoreInboxesToConnectedInstance(
  storeId: string,
  connectedInstanceId: string,
  options?: { specificInboxId?: string | null; exclusive?: boolean }
): Promise<{ updatedCount: number; updatedInboxIds: string[] }> {
  if (!storeId || !isValidUuid(connectedInstanceId)) {
    return { updatedCount: 0, updatedInboxIds: [] };
  }

  try {
    const candidateStoreIds = await resolveStoreCandidateIds(storeId);
    if (candidateStoreIds.length === 0) {
      return { updatedCount: 0, updatedInboxIds: [] };
    }

    // Se for conexão estritamente exclusiva para uma única caixa específica, atualiza apenas ela
    if (options?.exclusive) {
      if (!isValidUuid(options.specificInboxId)) {
        return { updatedCount: 0, updatedInboxIds: [] };
      }
      const { error } = await supabaseAdmin
        .from("inboxes")
        .update({ whatsapp_instance_id: connectedInstanceId })
        .eq("id", options.specificInboxId);

      if (!error) {
        console.log(
          `[InboxSync] Caixa exclusiva ${options.specificInboxId} vinculada à instância ${connectedInstanceId}`
        );
        return { updatedCount: 1, updatedInboxIds: [options.specificInboxId] };
      }
      return { updatedCount: 0, updatedInboxIds: [] };
    }

    // 1. Buscar instâncias desta loja para preservar canais exclusivos (ativos ou recém-criados)
    const { data: allInstances } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, status, instance_name")
      .in("store_id", candidateStoreIds);

    const otherConnectedIds = new Set<string>(
      (allInstances || [])
        .filter((i: any) => i.status === "CONNECTED" && isValidUuid(i.id) && i.id !== connectedInstanceId)
        .map((i: any) => i.id)
    );

    const exclusiveInstanceIds = new Set<string>(
      (allInstances || [])
        .filter((i: any) => isValidUuid(i.id) && i.id !== connectedInstanceId && isExclusiveInstanceName(i.instance_name))
        .map((i: any) => i.id)
    );

    // 2. Buscar todas as caixas de entrada desta loja
    const { data: storeInboxes, error: inboxErr } = await supabaseAdmin
      .from("inboxes")
      .select("id, whatsapp_instance_id")
      .in("store_id", candidateStoreIds);

    if (inboxErr || !storeInboxes || storeInboxes.length === 0) {
      if (isValidUuid(options?.specificInboxId)) {
        await supabaseAdmin
          .from("inboxes")
          .update({ whatsapp_instance_id: connectedInstanceId })
          .eq("id", options.specificInboxId);
        return { updatedCount: 1, updatedInboxIds: [options.specificInboxId] };
      }
      return { updatedCount: 0, updatedInboxIds: [] };
    }

    const inboxIdsToUpdate: string[] = [];
    for (const ib of storeInboxes) {
      if (!isValidUuid(ib.id)) continue;

      const isTargetSpecific = isValidUuid(options?.specificInboxId) && ib.id === options?.specificInboxId;
      const currentInstId = ib.whatsapp_instance_id;

      // Já está apontando para esta instância
      if (currentInstId === connectedInstanceId) continue;

      // Se aponta para OUTRA instância exclusiva (CONNECTED ou dedicada inbox_ex_*), preserva
      if (
        !isTargetSpecific &&
        isValidUuid(currentInstId) &&
        (otherConnectedIds.has(currentInstId) || exclusiveInstanceIds.has(currentInstId))
      ) {
        continue;
      }

      // Caso contrário (NULL, UUID antigo/órfão/desconectado compartilhado, ou caixa alvo), sincroniza para a nova instância CONNECTED
      inboxIdsToUpdate.push(ib.id);
    }

    if (inboxIdsToUpdate.length > 0) {
      const { error: updateErr } = await supabaseAdmin
        .from("inboxes")
        .update({ whatsapp_instance_id: connectedInstanceId })
        .in("id", inboxIdsToUpdate);

      if (updateErr) {
        console.warn("[InboxSync] Aviso ao sincronizar caixas de entrada:", updateErr.message);
        return { updatedCount: 0, updatedInboxIds: [] };
      }

      console.log(
        `[InboxSync] ✅ ${inboxIdsToUpdate.length} caixa(s) de entrada da loja "${storeId}" sincronizada(s) para instância CONNECTED ${connectedInstanceId}.`
      );
    }

    return { updatedCount: inboxIdsToUpdate.length, updatedInboxIds: inboxIdsToUpdate };
  } catch (err: any) {
    console.warn("[InboxSync] Exceção ao sincronizar inboxes:", err.message || err);
    return { updatedCount: 0, updatedInboxIds: [] };
  }
}

export class EvolutionApiService {
  /**
   * Resolução blindada da instância CONNECTED na Evolution API para envio de mensagens:
   * 1) Registro em public.whatsapp_instances onde id = inbox.whatsapp_instance_id AND status = 'CONNECTED'
   * 2) Fallback explícito (se informado explicitInstanceName e existir como CONNECTED em public.whatsapp_instances)
   * 3) Fallback automático: registro em public.whatsapp_instances onde store_id = conversa.store_id AND status = 'CONNECTED' (updated_at DESC LIMIT 1)
   * 4) NUNCA inventa instance_name inexistente (como inbox_<uuid>). Retorna null se não houver instância conectada.
   */
  public async resolveConnectedInstanceForSending(params: {
    storeId: string;
    conversationId?: string | null;
    inboxId?: string | null;
    explicitInstanceName?: string | null;
  }): Promise<ResolvedConnectedInstance | null> {
    let effectiveStoreId = String(params.storeId || "").trim();
    let effectiveInboxId = isValidUuid(params.inboxId) ? params.inboxId.trim() : null;

    // 0. Se conversationId foi informado, busca inbox_id e store_id reais da conversa
    if (params.conversationId && (!effectiveInboxId || !effectiveStoreId || effectiveStoreId === "default")) {
      try {
        const { data: conv } = await supabaseAdmin
          .from("chat_conversations")
          .select("inbox_id, store_id")
          .eq("id", params.conversationId)
          .maybeSingle();

        if (conv) {
          if (!effectiveInboxId && isValidUuid(conv.inbox_id)) {
            effectiveInboxId = conv.inbox_id.trim();
          }
          if (conv.store_id && (!effectiveStoreId || effectiveStoreId === "default")) {
            effectiveStoreId = String(conv.store_id).trim();
          }
        }
      } catch (err: any) {
        console.warn("[EvolutionApiService] Aviso ao consultar conversa para resolução de instância:", err.message);
      }
    }

    let inboxRow: { id: string; store_id?: string | null; whatsapp_instance_id?: string | null } | null = null;
    let isDedicatedExclusiveInbox = false;

    // 1. Tenta instância vinculada à Caixa de Entrada com status = 'CONNECTED'
    if (effectiveInboxId && isValidUuid(effectiveInboxId)) {
      try {
        const { data: ib } = await supabaseAdmin
          .from("inboxes")
          .select("id, store_id, whatsapp_instance_id")
          .eq("id", effectiveInboxId)
          .maybeSingle();

        if (ib) {
          inboxRow = ib;
          if (ib.store_id && (!effectiveStoreId || effectiveStoreId === "default")) {
            effectiveStoreId = String(ib.store_id).trim();
          }

          if (isValidUuid(ib.whatsapp_instance_id)) {
            const { data: linkedInst } = await supabaseAdmin
              .from("whatsapp_instances")
              .select("id, instance_name, store_id, phone_number, status")
              .eq("id", ib.whatsapp_instance_id)
              .maybeSingle();

            if (linkedInst?.instance_name && !isValidUuid(linkedInst.instance_name)) {
              if (linkedInst.status === "CONNECTED") {
                return {
                  ...linkedInst,
                  source: "inbox",
                };
              }
              // Se a caixa possui instância exclusiva dedicada (ex: inbox_ex_...) que ainda não conectou,
              // não sobrescreve nem cai no número compartilhado de outra caixa.
              if (isExclusiveInstanceName(linkedInst.instance_name)) {
                isDedicatedExclusiveInbox = true;
              }
            }
          }
        }
      } catch (err: any) {
        console.warn("[EvolutionApiService] Aviso ao consultar instância da inbox:", err.message);
      }
    }

    if (isDedicatedExclusiveInbox) {
      return null;
    }

    // 2. Se um instanceName explícito foi informado, aceita SOMENTE se existir e estiver CONNECTED no banco
    const cleanExplicit = String(params.explicitInstanceName || "").trim();
    if (cleanExplicit && !isValidUuid(cleanExplicit)) {
      try {
        const { data: expInst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_name, store_id, phone_number, status")
          .eq("instance_name", cleanExplicit)
          .eq("status", "CONNECTED")
          .maybeSingle();

        if (expInst?.instance_name && !isValidUuid(expInst.instance_name)) {
          return {
            ...expInst,
            source: "explicit",
          };
        }
      } catch (_) {}
    }

    // 3. Fallback automático: instância CONNECTED compartilhada mais recente da loja (store_id)
    const candidateStoreIds = await resolveStoreCandidateIds(effectiveStoreId || inboxRow?.store_id || params.storeId);
    if (candidateStoreIds.length > 0) {
      try {
        const { data: fallbackRows } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_name, store_id, phone_number, status, updated_at")
          .in("store_id", candidateStoreIds)
          .eq("status", "CONNECTED")
          .order("updated_at", { ascending: false });

        const validConnected = (fallbackRows || []).filter(
          (r: any) => r?.instance_name && !isValidUuid(r.instance_name)
        );
        const nonExclusiveFallback = validConnected.find((r: any) => !isExclusiveInstanceName(r.instance_name));
        const fallbackInst = nonExclusiveFallback || validConnected[0];

        if (fallbackInst?.instance_name) {
          // Auto-cura em background o whatsapp_instance_id órfão/nulo da caixa usada
          if (inboxRow && isValidUuid(inboxRow.id) && inboxRow.whatsapp_instance_id !== fallbackInst.id) {
            supabaseAdmin
              .from("inboxes")
              .update({ whatsapp_instance_id: fallbackInst.id })
              .eq("id", inboxRow.id)
              .then(({ error }) => {
                if (!error) {
                  console.log(
                    `[EvolutionApiService] Auto-cura: inbox ${inboxRow!.id} atualizada para instância CONNECTED ${fallbackInst.id} (${fallbackInst.instance_name})`
                  );
                }
              });
          }

          return {
            id: fallbackInst.id,
            instance_name: fallbackInst.instance_name,
            store_id: fallbackInst.store_id,
            phone_number: fallbackInst.phone_number,
            status: fallbackInst.status,
            source: "store_fallback",
          };
        }
      } catch (err: any) {
        console.warn("[EvolutionApiService] Aviso no fallback de instância CONNECTED da loja:", err.message);
      }
    }

    // 4. NUNCA inventar instance_name (ex: inbox_<uuid>) que não existe em public.whatsapp_instances
    return null;
  }

  /**
   * Resolve o instanceName correto do WhatsApp, priorizando instâncias CONNECTED em public.whatsapp_instances
   * e NUNCA fabricando `inbox_<uuid>` inexistente.
   */
  public async resolveInstanceName(
    storeIdOrTenantId: string = "",
    explicitInstanceName?: string
  ): Promise<string> {
    const cleanExplicit = String(explicitInstanceName || "").trim();
    if (cleanExplicit && !UUID_REGEX.test(cleanExplicit) && !cleanExplicit.startsWith("inbox_")) {
      return cleanExplicit;
    }

    // Se explícito começa com inbox_, valida se realmente existe em whatsapp_instances antes de aceitar
    if (cleanExplicit && cleanExplicit.startsWith("inbox_")) {
      try {
        const { data: existsInst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("instance_name", cleanExplicit)
          .eq("status", "CONNECTED")
          .maybeSingle();
        if (existsInst?.instance_name) {
          return existsInst.instance_name;
        }
      } catch (_) {}
    }

    const rawId = String(storeIdOrTenantId || "").trim();
    const candidateStoreIds = await resolveStoreCandidateIds(rawId);

    try {
      if (candidateStoreIds.length > 0) {
        // 1. Prioriza instância CONNECTED mais recente da loja
        const { data: connectedRows } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("instance_name, store_id, status")
          .in("store_id", candidateStoreIds)
          .eq("status", "CONNECTED")
          .order("updated_at", { ascending: false })
          .limit(1);

        if (connectedRows?.[0]?.instance_name && !isValidUuid(connectedRows[0].instance_name)) {
          return connectedRows[0].instance_name;
        }

        // 2. Fallback: qualquer instância existente da loja em whatsapp_instances
        const { data: anyRows } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("instance_name, store_id")
          .in("store_id", candidateStoreIds)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (anyRows?.[0]?.instance_name && !isValidUuid(anyRows[0].instance_name)) {
          return anyRows[0].instance_name;
        }
      }
    } catch (e: any) {
      console.warn("[EvolutionApiService] Aviso ao consultar whatsapp_instances:", e.message);
    }

    return "";
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

    // 1. Limpeza estrita do Base64 (A Evolution API v2 rejeita Data URI com 400! Exige Base64 puro)
    let cleanBase64 = audio;
    if (cleanBase64.includes(',')) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/\s/g, '');

    // 2. Payload oficial para /message/sendWhatsAppAudio:
    const payload = {
      number: cleanNumber,
      audio: cleanBase64, // APENAS base64 puro!
      delay: options.delay || 1200,
      encoding: true
    };

    console.log(`[EvolutionAPI] 🎙️ Disparando sendWhatsAppAudio para ${cleanNumber} via instância "${cleanInstance}" | Tamanho áudio Base64: ${cleanBase64.length} chars`);

    const endpoints = [
      `${url}/message/sendWhatsAppAudio/${cleanInstance}`,
      `${url}/chat/sendWhatsAppAudio/${cleanInstance}`
    ];

    let lastErrorStatus: number | null = null;
    let lastErrorText: string = "";

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
        lastErrorStatus = response.status;
        lastErrorText = responseText;
        console.warn(`[EvolutionAPI] Endpoint ${endpoint} retornou status ${response.status}:`, responseText);
      } catch (err: any) {
        console.warn(`[EvolutionAPI] Falha ao tentar endpoint ${endpoint}:`, err.message);
        lastErrorText = err.message;
      }
    }

    // 3. Fallback inteligente: se retornar erro 400 ou 404, use imediatamente /message/sendMedia
    console.warn(`[EvolutionAPI] ⚠️ Endpoints sendWhatsAppAudio falharam (status ${lastErrorStatus}). Acionando fallback inteligente /message/sendMedia para ${cleanNumber}...`);
    const mediaFallbackPayload = {
      number: cleanNumber,
      mediatype: 'audio',
      mimetype: 'audio/mp3',
      caption: '',
      media: cleanBase64,
      fileName: 'audio.mp3'
    };

    const mediaEndpoints = [
      `${url}/message/sendMedia/${cleanInstance}`,
      `${url}/chat/sendMedia/${cleanInstance}`
    ];

    for (const mediaEndpoint of mediaEndpoints) {
      try {
        const mediaRes = await fetch(mediaEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKeyToUse
          },
          body: JSON.stringify(mediaFallbackPayload)
        });

        const mediaResText = await mediaRes.text();
        let mediaResJson: any = null;
        try {
          mediaResJson = JSON.parse(mediaResText);
        } catch (_) {
          mediaResJson = { raw: mediaResText };
        }

        if (mediaRes.status === 200 || mediaRes.status === 201) {
          console.log(`[EvolutionAPI] ✅ Áudio WhatsApp entregue com sucesso via fallback sendMedia para ${cleanNumber}`);
          return { success: true, status: mediaRes.status, data: mediaResJson };
        }
        console.warn(`[EvolutionAPI] Fallback ${mediaEndpoint} retornou status ${mediaRes.status}:`, mediaResText);
      } catch (mediaErr: any) {
        console.warn(`[EvolutionAPI] Falha no fallback sendMedia (${mediaEndpoint}):`, mediaErr.message);
      }
    }

    return { 
      success: false, 
      error: `Falha ao enviar áudio em todos os endpoints da Evolution API: ${lastErrorText}`,
      status: lastErrorStatus || 500
    };
  }

  /**
   * Envia mídia (imagem, documento, vídeo ou áudio) via Evolution API (/message/sendMedia/{instance})
   */
  public async sendMediaMessage(
    instanceName: string,
    phoneNumber: string,
    mediaUrlOrBase64: string,
    mediaType: "image" | "video" | "document" | "audio" = "image",
    caption: string = "",
    fileName?: string
  ): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
    const cleanNumber = String(phoneNumber || "").replace(/\D/g, "");
    if (!instanceName || !cleanNumber || !mediaUrlOrBase64) {
      return { success: false, error: "Parâmetros inválidos para sendMediaMessage" };
    }

    if (mediaType === "audio") {
      return this.sendWhatsAppAudio(instanceName, cleanNumber, mediaUrlOrBase64);
    }

    const { url, key: apiKeyToUse } = await this.getInstanceConfig(instanceName);
    const cleanInstance = instanceName.trim();

    let cleanMedia = mediaUrlOrBase64.trim();
    let detectedMime =
      mediaType === "image"
        ? "image/jpeg"
        : mediaType === "video"
          ? "video/mp4"
          : "application/pdf";

    if (cleanMedia.startsWith("data:")) {
      const mimeMatch = cleanMedia.match(/^data:([^;]+);base64,(.+)$/i);
      if (mimeMatch) {
        detectedMime = mimeMatch[1];
        cleanMedia = mimeMatch[2].replace(/\s/g, "");
      } else if (cleanMedia.includes(",")) {
        cleanMedia = cleanMedia.split(",")[1].replace(/\s/g, "");
      }
    }

    const payload = {
      number: cleanNumber,
      mediatype: mediaType,
      mimetype: detectedMime,
      caption: caption || "",
      media: cleanMedia,
      fileName:
        fileName ||
        (mediaType === "image"
          ? "imagem.jpg"
          : mediaType === "video"
            ? "video.mp4"
            : "documento.pdf"),
      delay: 1200,
    };

    const endpoints = [
      `${url}/message/sendMedia/${cleanInstance}`,
      `${url}/chat/sendMedia/${cleanInstance}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: apiKeyToUse,
          },
          body: JSON.stringify(payload),
        });
        const resText = await res.text();
        let resJson: any = null;
        try {
          resJson = JSON.parse(resText);
        } catch {
          resJson = { raw: resText };
        }
        if (res.ok) {
          return { success: true, status: res.status, data: resJson };
        }
      } catch (err: any) {
        console.warn(`[EvolutionAPI] Aviso em sendMediaMessage (${endpoint}):`, err?.message);
      }
    }

    return { success: false, error: "Falha ao enviar mídia para Evolution API" };
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
