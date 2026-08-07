import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export type BotState = "BOT_WELCOME" | "BOT_TRIAGE" | "HUMAN_UNASSIGNED" | "HUMAN_ASSIGNED";

export interface HandoffResult {
  newState: BotState;
  assignedOperatorId?: string;
  message?: string;
}

export class BotHandoffManager {
  private static instance: BotHandoffManager;

  private constructor() {}

  public static getInstance(): BotHandoffManager {
    if (!BotHandoffManager.instance) {
      BotHandoffManager.instance = new BotHandoffManager();
    }
    return BotHandoffManager.instance;
  }

  // Termos sensíveis para transbordo imediato para o farmacêutico / atendente humano
  private sensitiveKeywords = [
    "atendente",
    "falar com humano",
    "farmaceutico",
    "farmacêutico",
    "receita",
    "remédio controlado",
    "remedio controlado",
    "duvida",
    "dúvida",
    "atendimento",
    "urgente",
    "prescrição",
    "prescricao"
  ];

  /**
   * Avalia a mensagem recebida no robô. Se detectar termo sensível, aciona o transbordo humano e Round-Robin.
   */
  public async processMessageState(
    conversationId: string,
    storeId: string,
    content: string,
    currentStatus: string
  ): Promise<HandoffResult> {
    const lowerContent = content.toLowerCase().trim();

    // Se já estiver em atendimento humano, mantém
    if (currentStatus === "in_progress") {
      return { newState: "HUMAN_ASSIGNED" };
    }

    // Verificar se a mensagem contém gatilhos de transbordo
    const triggersHandoff = this.sensitiveKeywords.some((term) => lowerContent.includes(term));

    if (triggersHandoff || lowerContent === "0" || lowerContent === "falar com atendente") {
      console.log(`[BotHandoffManager] Handoff triggered for conversation ${conversationId} (keyword match)`);

      // 1. Tentar alocação por Round-Robin de operadores online
      const assignedOperator = await this.allocateNextOnlineOperator(storeId);

      if (assignedOperator) {
        // Atribuído diretamente a um operador ativo
        await supabaseAdmin
          .from("chat_conversations")
          .update({
            assigned_user_id: assignedOperator.id,
            status: "in_progress",
            updated_at: new Date().toISOString()
          })
          .eq("id", conversationId);

        return {
          newState: "HUMAN_ASSIGNED",
          assignedOperatorId: assignedOperator.id,
          message: `Atendimento transferido para o atendente **${assignedOperator.full_name || assignedOperator.email}**.`
        };
      } else {
        // Nenhum operador disponível no momento: marcar como pendente/unassigned
        await supabaseAdmin
          .from("chat_conversations")
          .update({
            assigned_user_id: null,
            status: "pending",
            updated_at: new Date().toISOString()
          })
          .eq("id", conversationId);

        return {
          newState: "HUMAN_UNASSIGNED",
          message: "Sua solicitação foi encaminhada para a nossa equipe. Em instantes um de nossos balconistas irá atendê-lo."
        };
      }
    }

    return { newState: "BOT_TRIAGE" };
  }

  /**
   * Atribuição sequencial Round-Robin para operadores/farmacêuticos online da loja
   */
  private async allocateNextOnlineOperator(storeId: string) {
    try {
      // 1. Try tenant_users first as primary table
      const { data: tenantUsers } = await supabaseAdmin
        .from("tenant_users")
        .select("id, supabase_user_id, name, email, role, is_active")
        .eq("tenant_id", storeId)
        .eq("is_active", true);

      if (tenantUsers && tenantUsers.length > 0) {
        const nextUser = tenantUsers[0];
        return {
          id: nextUser.id,
          full_name: nextUser.name,
          email: nextUser.email,
          role: nextUser.role
        };
      }

      // 2. Fallback to profiles table
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, role, is_online, last_assigned_at")
        .eq("store_id", storeId)
        .eq("is_online", true)
        .order("last_assigned_at", { ascending: true, nullsFirst: true });

      if (error || !profiles || profiles.length === 0) {
        const { data: allProfiles } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, role, last_assigned_at")
          .eq("store_id", storeId)
          .order("last_assigned_at", { ascending: true, nullsFirst: true });

        if (!allProfiles || allProfiles.length === 0) return null;

        const nextOperator = allProfiles[0];
        try {
          await supabaseAdmin
            .from("profiles")
            .update({ last_assigned_at: new Date().toISOString() })
            .eq("id", nextOperator.id);
        } catch (_) {}

        return nextOperator;
      }

      const selectedOperator = profiles[0];
      try {
        await supabaseAdmin
          .from("profiles")
          .update({ last_assigned_at: new Date().toISOString() })
          .eq("id", selectedOperator.id);
      } catch (_) {}

      return selectedOperator;
    } catch (err) {
      console.warn("[BotHandoffManager] Erro no Round-Robin:", err);
      return null;
    }
  }
}

export const botHandoffManager = BotHandoffManager.getInstance();
