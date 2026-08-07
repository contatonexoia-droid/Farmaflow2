import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export class CsatManager {
  private static instance: CsatManager;

  private constructor() {}

  public static getInstance(): CsatManager {
    if (!CsatManager.instance) {
      CsatManager.instance = new CsatManager();
    }
    return CsatManager.instance;
  }

  /**
   * Agenda ou envia a mensagem de pesquisa CSAT para o cliente após a entrega do pedido
   */
  public async scheduleCsatSurvey(orderId: string, delayMinutes = 15) {
    console.log(`[CsatManager] Scheduling CSAT survey for order ${orderId} in ${delayMinutes} minutes...`);

    setTimeout(async () => {
      await this.sendCsatSurvey(orderId);
    }, delayMinutes * 60 * 1000);
  }

  public async sendCsatSurvey(orderId: string) {
    try {
      // Buscar dados do pedido e cliente
      const { data: order, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (error || !order) {
        console.error(`[CsatManager] Order ${orderId} not found for CSAT survey:`, error);
        return;
      }

      if (!order.phone) return;

      const storeId = order.tenant_id;
      const instanceName = `store_${storeId.replace(/-/g, "")}`;
      const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
      const evolutionKey = process.env.EVOLUTION_API_KEY;

      if (!evolutionUrl || !evolutionKey) return;

      const csatPromptText = `Olá, ${order.customer_name || "Cliente"}! 🛵💨\n\nSeu pedido na farmácia foi entregue! Por favor, como você avalia nosso atendimento e a entrega?\n\nResponda com uma nota de *1 a 5*:\n\n1️⃣ - Muito Insatisfeito\n2️⃣ - Insatisfeito\n3️⃣ - Neutro\n4️⃣ - Satisfeito\n5️⃣ - Excelente!`;

      const targetPhone = order.phone.replace(/\D/g, "");

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          number: targetPhone,
          text: csatPromptText,
        }),
      });

      console.log(`[CsatManager] CSAT survey sent for order ${orderId} to phone ${order.phone}`);
    } catch (err) {
      console.error(`[CsatManager] Error sending CSAT survey for order ${orderId}:`, err);
    }
  }

  /**
   * Registra a resposta CSAT recebida do cliente
   */
  public async recordCsatResponse(storeId: string, phone: string, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) return;

    try {
      await supabaseAdmin.from("csat_ratings").insert({
        store_id: storeId,
        phone: phone.replace(/\D/g, ""),
        rating,
        comment: comment || null,
        created_at: new Date().toISOString(),
      });

      console.log(`[CsatManager] CSAT Rating ${rating}/5 recorded for store ${storeId} from ${phone}`);
    } catch (err) {
      console.error("[CsatManager] Error recording CSAT rating:", err);
    }
  }

  /**
   * Calcula o índice CSAT médio e distribuição da loja
   */
  public async getStoreCsatMetrics(storeId: string) {
    const { data: ratings, error } = await supabaseAdmin
      .from("csat_ratings")
      .select("rating")
      .eq("store_id", storeId);

    if (error || !ratings || ratings.length === 0) {
      return { averageRating: 0, totalResponses: 0, csatScorePercentage: 0 };
    }

    const total = ratings.length;
    const sum = ratings.reduce((acc, curr) => acc + curr.rating, 0);
    const averageRating = Math.round((sum / total) * 10) / 10;

    // CSAT Score = (% de notas 4 e 5)
    const satisfiedCount = ratings.filter((r) => r.rating >= 4).length;
    const csatScorePercentage = Math.round((satisfiedCount / total) * 100);

    return {
      averageRating,
      totalResponses: total,
      csatScorePercentage,
    };
  }
}

export const csatManager = CsatManager.getInstance();
