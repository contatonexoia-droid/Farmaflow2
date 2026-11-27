import { createClient } from "@supabase/supabase-js";
import { inboxStore, InboxItem } from "./inboxStore.js";
import { chatStore, isValidUuid, sanitizeChatConversationPayload } from "./chatStore.js";
import { evolutionApiService, resolveStoreCandidateIds } from "./evolutionApiService.js";
import { realtimeHub } from "./realtimeHub.js";
import { botSentMessageIds, registerBotSentMessage } from "./botHandoffManager.js";

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export type StoreSegmentType = "drogaria" | "manipulacao";
export type ManipulacaoRoutingMode = "least_busy" | "wait_for_free";

const CLOSED_STATUSES = new Set([
  "closed",
  "finalizado",
  "finalizada",
  "resolved",
  "fechado",
  "encerrado",
  "encerrada",
  "concluido",
  "concluida",
]);

export function resolveTenantStoreType(tenant: any): StoreSegmentType {
  if (!tenant || typeof tenant !== "object") return "drogaria";
  const sb = tenant.smart_banners || tenant.smartbanners || tenant.smartBanners || {};
  const raw =
    tenant.store_type ||
    tenant.storeType ||
    tenant.storetype ||
    sb?._storeType ||
    "drogaria";
  return String(raw).toLowerCase().trim() === "manipulacao" ? "manipulacao" : "drogaria";
}

export function getManipulacaoRoutingMode(tenant: any): ManipulacaoRoutingMode {
  const aiCfg = tenant?.ai_agent_config || tenant?.aiagentconfig || tenant?.aiAgentConfig || {};
  return aiCfg?.manipulacaoRoutingMode === "wait_for_free" ? "wait_for_free" : "least_busy";
}

export async function getManipulacaoTenant(storeId: string): Promise<any | null> {
  if (!storeId) return null;
  const cleanId = String(storeId).trim().replace(/^store_/, "").replace(/^tenant_/, "");
  const candidates = Array.from(new Set([storeId.trim(), cleanId].filter(Boolean)));

  try {
    const { data: byId } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .in("id", candidates)
      .limit(1)
      .maybeSingle();
    if (byId) return byId;

    const { data: bySlug } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .in("slug", candidates)
      .limit(1)
      .maybeSingle();
    if (bySlug) return bySlug;
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Erro ao consultar tenant:", err?.message || err);
  }
  return null;
}

export async function isManipulacaoStore(storeId: string): Promise<boolean> {
  const tenant = await getManipulacaoTenant(storeId);
  return resolveTenantStoreType(tenant) === "manipulacao";
}

export function isActiveConversationForInbox(conv: any): boolean {
  if (!conv) return false;
  const statusLower = String(conv.status || "").toLowerCase().trim();
  const stageLower = String(conv.kanban_stage || conv.stage || "").toLowerCase().trim();

  if (CLOSED_STATUSES.has(statusLower) || CLOSED_STATUSES.has(stageLower)) {
    return false;
  }
  if (statusLower === "waiting_routing") {
    return false;
  }
  // Conversas ainda em triagem inicial com a IA (não transferidas para humano) não ocupam a atendente
  if (conv.is_bot_active === true && conv.is_human_controlled !== true) {
    return false;
  }
  if ((statusLower === "bot" || stageLower === "ia_atendendo") && conv.is_human_controlled !== true) {
    return false;
  }
  return true;
}

export async function getInboxActiveConversationCounts(storeId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!storeId) return counts;

  try {
    const candidateIds = await resolveStoreCandidateIds(storeId);
    const ids = candidateIds.length > 0 ? candidateIds : [storeId];

    const { data, error } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, inbox_id, status, kanban_stage, stage, is_bot_active, is_human_controlled")
      .in("store_id", ids);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (!row?.inbox_id || !isValidUuid(row.inbox_id)) continue;
        if (isActiveConversationForInbox(row)) {
          counts[row.inbox_id] = (counts[row.inbox_id] || 0) + 1;
        }
      }
      return counts;
    }
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Falha ao contar conversas ativas no Supabase:", err?.message || err);
  }

  return counts;
}

function compareByIdleRoundRobin(a: InboxItem, b: InboxItem): number {
  const ta = a.last_routed_at ? new Date(a.last_routed_at).getTime() : 0;
  const tb = b.last_routed_at ? new Date(b.last_routed_at).getTime() : 0;
  if (ta !== tb) return ta - tb;
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return ca - cb;
}

export async function findBestRoutingCandidates(storeId: string): Promise<{
  eligibleInboxes: InboxItem[];
  freeInboxes: InboxItem[];
  busyInboxes: Array<{ inbox: InboxItem; activeCount: number }>;
  activeCounts: Record<string, number>;
}> {
  const [allInboxes, activeCounts] = await Promise.all([
    inboxStore.getInboxes(storeId),
    getInboxActiveConversationCounts(storeId),
  ]);

  const eligibleInboxes = allInboxes.filter(
    (ib) => ib.ai_routing_enabled === true && ib.is_available_for_routing !== false
  );

  const freeInboxes: InboxItem[] = [];
  const busyInboxes: Array<{ inbox: InboxItem; activeCount: number }> = [];

  for (const ib of eligibleInboxes) {
    const count = activeCounts[ib.id] || 0;
    if (count === 0) {
      freeInboxes.push(ib);
    } else {
      busyInboxes.push({ inbox: ib, activeCount: count });
    }
  }

  freeInboxes.sort(compareByIdleRoundRobin);
  busyInboxes.sort((x, y) => {
    if (x.activeCount !== y.activeCount) return x.activeCount - y.activeCount;
    return compareByIdleRoundRobin(x.inbox, y.inbox);
  });

  return { eligibleInboxes, freeInboxes, busyInboxes, activeCounts };
}

async function resolveSoleInboxAssignee(inboxId: string): Promise<{ userId: string | null; userName: string | null }> {
  try {
    const members = await inboxStore.getMembers(inboxId);
    if (members.length === 1 && isValidUuid(members[0])) {
      const userId = members[0].trim();
      try {
        const { data: tu } = await supabaseAdmin
          .from("tenant_users")
          .select("name, email")
          .eq("id", userId)
          .maybeSingle();
        return { userId, userName: tu?.name || tu?.email || null };
      } catch (_) {
        return { userId, userName: null };
      }
    }
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Erro ao buscar membros da caixa:", err?.message || err);
  }
  return { userId: null, userName: null };
}

async function sendWhatsAppNoticeAndRecord(params: {
  storeId: string;
  conversationId: string;
  instanceName: string;
  phoneNumber: string | null;
  text: string;
}): Promise<boolean> {
  const { storeId, conversationId, instanceName, phoneNumber, text } = params;
  const cleanPhone = phoneNumber ? String(phoneNumber).replace(/\D/g, "") : "";
  let remoteId: string | null = null;

  if (cleanPhone && instanceName) {
    try {
      const sendRes = await evolutionApiService.sendTextMessage(instanceName, cleanPhone, text, {
        delay: 800,
        linkPreview: false,
      });

      if (sendRes?.success) {
        const candidates = [
          sendRes.data?.key?.id,
          sendRes.data?.message?.key?.id,
          sendRes.data?.messages?.[0]?.key?.id,
          sendRes.data?.id,
          sendRes.data?.messageId,
          (sendRes as any).key?.id,
          (sendRes as any).id,
        ].filter(Boolean);

        for (const cid of candidates) {
          const s = String(cid).trim();
          botSentMessageIds.add(s);
          registerBotSentMessage(s, conversationId, cleanPhone);
        }
        remoteId = candidates[0] ? String(candidates[0]).trim() : null;
      } else {
        console.warn("[ManipulacaoRouter] Falha ao enviar WhatsApp de roteamento:", sendRes?.error);
      }
    } catch (err: any) {
      console.warn("[ManipulacaoRouter] Exceção ao enviar WhatsApp:", err?.message || err);
    }
  }

  try {
    const { message, deduplicated } = await chatStore.addMessage(
      storeId,
      conversationId,
      "BOT",
      text,
      false,
      undefined,
      undefined,
      instanceName,
      true,
      undefined,
      { remoteId }
    );
    if (!deduplicated) {
      realtimeHub.broadcastToStore(storeId, "chat_message", {
        conversationId,
        message: {
          ...message,
          sender: "bot",
          sender_type: "BOT",
          is_from_bot: true,
        },
      });
    }
    return true;
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Falha ao persistir mensagem do roteador:", err?.message || err);
    return false;
  }
}

async function saveInternalTriageNote(params: {
  storeId: string;
  conversationId: string;
  noteText: string;
}): Promise<void> {
  try {
    const { message } = await chatStore.addMessage(
      params.storeId,
      params.conversationId,
      "BOT",
      params.noteText,
      true,
      undefined,
      undefined,
      undefined,
      true
    );
    realtimeHub.broadcastToStore(params.storeId, "chat_message", {
      conversationId: params.conversationId,
      message: {
        ...message,
        sender: "bot",
        sender_type: "BOT",
        is_private: true,
        isPrivate: true,
      },
    });
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Aviso ao gravar nota interna de triagem:", err?.message || err);
  }
}

async function assignConversationToTargetInbox(params: {
  storeId: string;
  conversationId: string;
  targetInbox: InboxItem;
  instanceName: string;
  phoneNumber: string | null;
  summaryText: string;
  customerMessage: string;
  handoffReason?: string;
  interactionCount?: number;
}): Promise<void> {
  const {
    storeId,
    conversationId,
    targetInbox,
    instanceName,
    phoneNumber,
    summaryText,
    customerMessage,
    handoffReason = "MANIPULACAO_AI_ROUTED",
    interactionCount,
  } = params;
  const nowIso = new Date().toISOString();
  const sole = await resolveSoleInboxAssignee(targetInbox.id);

  const convUpdates: Record<string, any> = {
    inbox_id: targetInbox.id,
    assigned_user_id: sole.userId,
    assigned_to: sole.userId,
    is_bot_active: false,
    is_human_controlled: true,
    status: "human_takeover",
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
    bot_handoff_reason: handoffReason,
    bot_handoff_at: nowIso,
    updated_at: nowIso,
  };
  if (typeof interactionCount === "number") {
    convUpdates.bot_interaction_count = interactionCount;
  }

  const sanitized = sanitizeChatConversationPayload(convUpdates);
  try {
    const { error } = await supabaseAdmin
      .from("chat_conversations")
      .update(sanitized)
      .eq("id", conversationId);

    if (error && sanitized.assigned_user_id) {
      const retry = { ...sanitized };
      delete retry.assigned_user_id;
      await supabaseAdmin.from("chat_conversations").update(retry).eq("id", conversationId);
    }

    if (targetInbox.name) {
      await supabaseAdmin
        .from("chat_conversations")
        .update({ department: targetInbox.name } as any)
        .eq("id", conversationId);
    }
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Erro ao atualizar conversa para caixa destino:", err?.message || err);
  }

  await chatStore.updateConversationBotStatus(conversationId, convUpdates);
  await inboxStore.markInboxRouted(targetInbox.id, storeId);

  const internalNote = `🤖 *Resumo da Triagem (IA Orquestradora)*\n${summaryText}\n\n📥 Direcionado para: *${targetInbox.name}*${sole.userName ? ` (${sole.userName})` : ""}`;
  await saveInternalTriageNote({
    storeId,
    conversationId,
    noteText: internalNote,
  });

  await sendWhatsAppNoticeAndRecord({
    storeId,
    conversationId,
    instanceName,
    phoneNumber,
    text: customerMessage,
  });

  realtimeHub.broadcastToStore(storeId, "conversation_transferred", {
    conversationId,
    inbox_id: targetInbox.id,
    inboxId: targetInbox.id,
    department: targetInbox.name,
    assigned_user_id: sole.userId,
    is_bot_active: false,
    is_human_controlled: true,
    status: "human_takeover",
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
  });

  realtimeHub.broadcastToStore(storeId, "conversation_bot_toggled", {
    conversationId,
    is_bot_active: false,
    is_human_controlled: true,
    status: "human_takeover",
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
  });

  realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
    conversationId,
    inbox_id: targetInbox.id,
    status: "human_takeover",
    is_bot_active: false,
    is_human_controlled: true,
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
    bot_handoff_reason: handoffReason,
    bot_handoff_at: nowIso,
  });

  realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
    conversationId,
    inbox_id: targetInbox.id,
    stage: "em_atendimento",
    kanban_stage: "em_atendimento",
    status: "human_takeover",
    is_bot_active: false,
    is_human_controlled: true,
    updated_at: nowIso,
  });
}

export async function routeManipulacaoConversation(params: {
  storeId: string;
  tenant: any;
  conversationId: string;
  instanceName: string;
  phoneNumber: string | null;
  summaryText: string;
  customIntroText?: string | null;
  interactionCount?: number;
}): Promise<{
  handled: boolean;
  routed: boolean;
  queued: boolean;
  targetInboxId?: string | null;
  targetInboxName?: string | null;
  replyText: string;
  reason: string;
}> {
  const {
    storeId,
    tenant,
    conversationId,
    instanceName,
    phoneNumber,
    summaryText,
    customIntroText,
    interactionCount,
  } = params;

  if (resolveTenantStoreType(tenant) !== "manipulacao") {
    return {
      handled: false,
      routed: false,
      queued: false,
      replyText: "",
      reason: "NOT_MANIPULACAO",
    };
  }

  const { eligibleInboxes, freeInboxes, busyInboxes } = await findBestRoutingCandidates(storeId);
  const routingMode = getManipulacaoRoutingMode(tenant);
  const nowIso = new Date().toISOString();
  const intro = customIntroText ? `${customIntroText.trim()}\n\n` : "";

  // Prioridade 1: Caixa elegível com 0 atendimentos ativos (livre)
  if (freeInboxes.length > 0) {
    const targetInbox = freeInboxes[0];
    const customerMessage =
      `${intro}Já recebi suas informações e direcionei o seu atendimento para *${targetInbox.name}*, que está livre agora para continuar com você! Em instantes respondemos. 😊`.trim();

    await assignConversationToTargetInbox({
      storeId,
      conversationId,
      targetInbox,
      instanceName,
      phoneNumber,
      summaryText,
      customerMessage,
      handoffReason: "MANIPULACAO_AI_ROUTED",
      interactionCount,
    });

    console.log(
      `[ManipulacaoRouter] ✅ Conversa ${conversationId} direcionada para caixa LIVRE "${targetInbox.name}" (${targetInbox.id}).`
    );

    return {
      handled: true,
      routed: true,
      queued: false,
      targetInboxId: targetInbox.id,
      targetInboxName: targetInbox.name,
      replyText: customerMessage,
      reason: "MANIPULACAO_AI_ROUTED_FREE",
    };
  }

  // Prioridade 2: Todas as caixas elegíveis estão ocupadas (> 0 atendimentos)
  if (busyInboxes.length > 0) {
    if (routingMode === "wait_for_free") {
      const waitMessage =
        `${intro}Recebemos sua solicitação! 😊 No momento nossas atendentes estão finalizando outros atendimentos, mas você já está na fila prioritária e assim que uma ficar livre ela assumirá por aqui!`.trim();

      const queueUpdates: Record<string, any> = {
        assigned_user_id: null,
        assigned_to: null,
        is_bot_active: false,
        is_human_controlled: false,
        status: "waiting_routing",
        kanban_stage: "novos_triagem",
        stage: "novos_triagem",
        bot_handoff_reason: "MANIPULACAO_WAIT_FREE",
        bot_handoff_at: nowIso,
        updated_at: nowIso,
      };
      if (typeof interactionCount === "number") {
        queueUpdates.bot_interaction_count = interactionCount;
      }

      const sanitized = sanitizeChatConversationPayload(queueUpdates);
      try {
        await supabaseAdmin
          .from("chat_conversations")
          .update(sanitized)
          .eq("id", conversationId);
      } catch (err: any) {
        console.warn("[ManipulacaoRouter] Erro ao colocar conversa na fila:", err?.message || err);
      }

      await chatStore.updateConversationBotStatus(conversationId, queueUpdates);

      await saveInternalTriageNote({
        storeId,
        conversationId,
        noteText: `⏳ *Resumo da Triagem (Aguardando Atendente Livre)*\n${summaryText}`,
      });

      await sendWhatsAppNoticeAndRecord({
        storeId,
        conversationId,
        instanceName,
        phoneNumber,
        text: waitMessage,
      });

      realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
        conversationId,
        status: "waiting_routing",
        is_bot_active: false,
        is_human_controlled: false,
        kanban_stage: "novos_triagem",
        stage: "novos_triagem",
        bot_handoff_reason: "MANIPULACAO_WAIT_FREE",
        bot_handoff_at: nowIso,
      });

      realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
        conversationId,
        stage: "novos_triagem",
        kanban_stage: "novos_triagem",
        status: "waiting_routing",
        is_bot_active: false,
        is_human_controlled: false,
        updated_at: nowIso,
      });

      console.log(
        `[ManipulacaoRouter] ⏳ Todas as caixas elegíveis ocupadas (modo wait_for_free). Conversa ${conversationId} colocada em waiting_routing.`
      );

      return {
        handled: true,
        routed: false,
        queued: true,
        targetInboxId: null,
        targetInboxName: null,
        replyText: waitMessage,
        reason: "MANIPULACAO_WAIT_FREE",
      };
    }

    // Modo padrão: 'least_busy' -> envia para a caixa com menor quantidade de atendimentos
    const leastBusyTarget = busyInboxes[0].inbox;
    const customerMessage =
      `${intro}Já recebi suas informações e direcionei o seu atendimento para *${leastBusyTarget.name}*! Em instantes nossa equipe dará continuidade ao seu orçamento. 😊`.trim();

    await assignConversationToTargetInbox({
      storeId,
      conversationId,
      targetInbox: leastBusyTarget,
      instanceName,
      phoneNumber,
      summaryText,
      customerMessage,
      handoffReason: "MANIPULACAO_AI_ROUTED_LEAST_BUSY",
      interactionCount,
    });

    console.log(
      `[ManipulacaoRouter] ✅ Conversa ${conversationId} direcionada (menor carga: ${busyInboxes[0].activeCount}) para "${leastBusyTarget.name}".`
    );

    return {
      handled: true,
      routed: true,
      queued: false,
      targetInboxId: leastBusyTarget.id,
      targetInboxName: leastBusyTarget.name,
      replyText: customerMessage,
      reason: "MANIPULACAO_AI_ROUTED_LEAST_BUSY",
    };
  }

  // Fallback seguro caso nenhuma caixa tenha sido marcada com ai_routing_enabled = true
  const fallbackMessage =
    `${intro}Recebi suas informações! Já encaminhei o seu atendimento para nossa equipe de manipulação dar continuidade por aqui. Só um instante! 😊`.trim();

  const fallbackUpdates: Record<string, any> = {
    is_bot_active: false,
    is_human_controlled: true,
    status: "human_takeover",
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
    bot_handoff_reason: "MANIPULACAO_NO_ELIGIBLE_INBOX",
    bot_handoff_at: nowIso,
    updated_at: nowIso,
  };
  if (typeof interactionCount === "number") {
    fallbackUpdates.bot_interaction_count = interactionCount;
  }

  try {
    await supabaseAdmin
      .from("chat_conversations")
      .update(sanitizeChatConversationPayload(fallbackUpdates))
      .eq("id", conversationId);
  } catch (_) {}

  await chatStore.updateConversationBotStatus(conversationId, fallbackUpdates);

  await saveInternalTriageNote({
    storeId,
    conversationId,
    noteText: `🤖 *Resumo da Triagem (Nenhuma caixa habilitada na roleta da IA)*\n${summaryText}`,
  });

  await sendWhatsAppNoticeAndRecord({
    storeId,
    conversationId,
    instanceName,
    phoneNumber,
    text: fallbackMessage,
  });

  realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
    conversationId,
    status: "human_takeover",
    is_bot_active: false,
    is_human_controlled: true,
    kanban_stage: "em_atendimento",
    stage: "em_atendimento",
  });

  console.warn(
    `[ManipulacaoRouter] ⚠️ Nenhuma caixa elegível (ai_routing_enabled=true & disponível) na loja ${storeId} (${eligibleInboxes.length}). Mantendo na caixa atual em atendimento humano.`
  );

  return {
    handled: true,
    routed: false,
    queued: false,
    replyText: fallbackMessage,
    reason: "MANIPULACAO_NO_ELIGIBLE_INBOX",
  };
}

export async function processNextQueuedConversationIfFreed(
  storeId: string,
  freedInboxId?: string | null
): Promise<{ assignedConversationId: string; targetInboxId: string } | null> {
  try {
    const tenant = await getManipulacaoTenant(storeId);
    if (!tenant || resolveTenantStoreType(tenant) !== "manipulacao") {
      return null;
    }

    const realTenantId = tenant.id || storeId;
    const { freeInboxes } = await findBestRoutingCandidates(realTenantId);
    if (freeInboxes.length === 0) {
      return null;
    }

    const targetInbox =
      (freedInboxId && freeInboxes.find((ib) => ib.id === freedInboxId)) || freeInboxes[0];

    const candidateStoreIds = await resolveStoreCandidateIds(realTenantId);
    const { data: queuedRows, error } = await supabaseAdmin
      .from("chat_conversations")
      .select("*, contact:chat_contacts(*)")
      .in("store_id", candidateStoreIds.length > 0 ? candidateStoreIds : [realTenantId])
      .eq("status", "waiting_routing")
      .order("bot_handoff_at", { ascending: true })
      .order("updated_at", { ascending: true })
      .limit(1);

    if (error || !queuedRows || queuedRows.length === 0) {
      return null;
    }

    const nextConv = queuedRows[0];
    let phone: string | null = nextConv?.contact?.phone_number || null;
    if (!phone && nextConv?.contact_id) {
      try {
        const { data: cRow } = await supabaseAdmin
          .from("chat_contacts")
          .select("phone_number")
          .eq("id", nextConv.contact_id)
          .maybeSingle();
        if (cRow?.phone_number) phone = cRow.phone_number;
      } catch (_) {}
    }

    const instanceName = await evolutionApiService.resolveInstanceName(realTenantId);
    const customerNotice = `Ótima notícia! Uma atendente acabou de ficar disponível e seu atendimento foi direcionado para *${targetInbox.name}*. Já vamos continuar com você! 😊`;
    const summaryText = `Conversa liberada automaticamente da fila de espera após disponibilidade da caixa *${targetInbox.name}*.`;

    await assignConversationToTargetInbox({
      storeId: realTenantId,
      conversationId: nextConv.id,
      targetInbox,
      instanceName,
      phoneNumber: phone,
      summaryText,
      customerMessage: customerNotice,
      handoffReason: "MANIPULACAO_QUEUE_PROMOTED",
    });

    console.log(
      `[ManipulacaoRouter] 🚀 Fila liberada: conversa ${nextConv.id} promovida para caixa livre "${targetInbox.name}".`
    );

    return {
      assignedConversationId: nextConv.id,
      targetInboxId: targetInbox.id,
    };
  } catch (err: any) {
    console.warn("[ManipulacaoRouter] Erro ao processar próximo da fila:", err?.message || err);
    return null;
  }
}
