import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export interface RefillCustomer {
  id: string;
  phone: string;
  name: string;
  store_id: string;
  custom_attributes: {
    uso_continuo?: boolean;
    dias_intervalo?: number;
    ultimo_pedido_at?: string;
    medicamento_nome?: string;
  };
}

export class ContinuousUseRefillManager {
  private static instance: ContinuousUseRefillManager;

  private constructor() {}

  public static getInstance(): ContinuousUseRefillManager {
    if (!ContinuousUseRefillManager.instance) {
      ContinuousUseRefillManager.instance = new ContinuousUseRefillManager();
    }
    return ContinuousUseRefillManager.instance;
  }

  /**
   * Cron Job diário que varre clientes cadastrados para recompra de uso contínuo
   */
  public async checkAndTriggerRefillReminders() {
    console.log("[ContinuousUseRefillManager] Running daily refill reminder check...");

    const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
    const evolutionKey = process.env.EVOLUTION_API_KEY;

    if (!evolutionUrl || !evolutionKey) {
      console.warn("[ContinuousUseRefillManager] Evolution API credentials missing. Skipping reminders.");
      return;
    }

    try {
      // Buscar clientes que possuem custom_attributes habilitados para uso contínuo
      const { data: contacts, error } = await supabaseAdmin
        .from("contacts")
        .select("*")
        .not("custom_attributes", "is", null);

      if (error || !contacts) {
        console.error("[ContinuousUseRefillManager] Error fetching contacts:", error);
        return;
      }

      const now = new Date();
      let sentCount = 0;

      for (const contact of contacts) {
        const attrs = contact.custom_attributes || {};

        if (attrs.uso_continuo && attrs.ultimo_pedido_at && attrs.dias_intervalo) {
          const lastOrderDate = new Date(attrs.ultimo_pedido_at);
          const intervalDays = Number(attrs.dias_intervalo) || 30;

          // Calcular diferença em dias
          const diffMs = now.getTime() - lastOrderDate.getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

          // Notificar quando estiver no ciclo final (ex: entre (intervalo - 3) dias e (intervalo) dias)
          const isDue = diffDays >= intervalDays - 3 && diffDays <= intervalDays + 2;

          if (isDue) {
            const lastRemindedAt = attrs.ultimo_lembrete_at ? new Date(attrs.ultimo_lembrete_at) : null;
            // Evitar enviar mais de 1 lembrete no mesmo ciclo (nos últimos 7 dias)
            if (lastRemindedAt && (now.getTime() - lastRemindedAt.getTime()) < 7 * 24 * 60 * 60 * 1000) {
              continue;
            }

            const storeId = contact.store_id;
            const instanceName = `store_${storeId.replace(/-/g, "")}`;
            const medName = attrs.medicamento_nome || "seu medicamento de uso contínuo";

            const messageText = `Olá, ${contact.name || "Cliente"}! 👋\n\nIdentificamos que o seu tratamento com *${medName}* está no ciclo de renovação. 💊\n\nDeseja realizar a renovação automática do seu pedido para entrega hoje? Responda *SIM* para confirmar com nossa equipe!`;

            // Enviar mensagem via Evolution API
            const targetPhone = contact.phone.replace(/\D/g, "");
            await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: evolutionKey,
              },
              body: JSON.stringify({
                number: targetPhone,
                text: messageText,
              }),
            });

            // Atualizar o timestamp do último lembrete no custom_attributes
            const updatedAttrs = {
              ...attrs,
              ultimo_lembrete_at: now.toISOString(),
            };

            await supabaseAdmin
              .from("contacts")
              .update({ custom_attributes: updatedAttrs })
              .eq("id", contact.id);

            sentCount++;
            console.log(`[ContinuousUseRefillManager] Refill reminder sent to ${contact.phone} (${contact.name})`);
          }
        }
      }

      console.log(`[ContinuousUseRefillManager] Completed check. Total reminders sent: ${sentCount}`);
    } catch (err: any) {
      console.error("[ContinuousUseRefillManager] Error in refill cron:", err);
    }
  }
}

export const continuousUseRefillManager = ContinuousUseRefillManager.getInstance();
