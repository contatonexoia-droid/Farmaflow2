import { createClient } from "@supabase/supabase-js";
import { EventEmitter } from "events";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export type HealthStatus = "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "QRCODE";

export interface InstanceHealthState {
  storeId: string;
  instanceName: string;
  status: HealthStatus;
  lastCheckAt: string;
  consecutiveFailures: number;
}

export class WhatsappHealthManager extends EventEmitter {
  private static instance: WhatsappHealthManager;
  private healthMap: Map<string, InstanceHealthState> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.startHealthCheckLoop();
  }

  public static getInstance(): WhatsappHealthManager {
    if (!WhatsappHealthManager.instance) {
      WhatsappHealthManager.instance = new WhatsappHealthManager();
    }
    return WhatsappHealthManager.instance;
  }

  private startHealthCheckLoop() {
    if (process.env.VERCEL) return;

    // Heartbeat a cada 30 segundos
    this.checkInterval = setInterval(() => {
      this.runHealthChecks().catch((err) => {
        // Silent catch
      });
    }, 30000);
  }

  public async runHealthChecks() {
    const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
    const evolutionKey = process.env.EVOLUTION_API_KEY;

    if (
      !evolutionUrl ||
      !evolutionKey ||
      evolutionUrl.includes("seudominio.com") ||
      evolutionUrl.includes("yourdomain.com") ||
      evolutionKey.includes("sua-global-api-key")
    ) {
      return;
    }

    // Buscar todas as instâncias cadastradas
    const { data: instances, error } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*");

    if (error || !instances) return;

    for (const inst of instances) {
      await this.checkInstanceHealth(inst, evolutionUrl, evolutionKey);
    }
  }

  public async checkInstanceHealth(inst: any, evolutionUrl: string, evolutionKey: string) {
    const storeId = inst.store_id;
    const instanceName = inst.instance_name || `store_${storeId.replace(/-/g, "")}`;
    const previousState: HealthStatus = this.healthMap.get(storeId)?.status || inst.status || "DISCONNECTED";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const stateRes = await fetch(`${evolutionUrl}/instance/connectionState/${instanceName}`, {
        headers: { apikey: evolutionKey },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (stateRes.status === 404) {
        // Se a instância não existe na Evolution mas está em QRCODE no FarmaFlow, mantemos em QRCODE para pareamento
        if (previousState === "QRCODE") {
          return;
        }
        await this.handleStatusChange(storeId, instanceName, "DISCONNECTED", previousState, "Instância não encontrada na Evolution API.");
        return;
      }

      if (!stateRes.ok) {
        return;
      }

      const stateData = await stateRes.json().catch(() => ({}));
      const rawState = stateData?.instance?.state || stateData?.state;

      let currentStatus: HealthStatus = previousState;
      if (rawState === "open") {
        currentStatus = "CONNECTED";
      } else if (rawState === "connecting") {
        currentStatus = "RECONNECTING";
      } else if (rawState === "close" || rawState === "refused") {
        currentStatus = previousState === "QRCODE" ? "QRCODE" : "DISCONNECTED";
      }

      if (currentStatus !== previousState) {
        await this.handleStatusChange(storeId, instanceName, currentStatus, previousState, `State: ${rawState}`);
      }

      // Atualiza mapa interno
      this.healthMap.set(storeId, {
        storeId,
        instanceName,
        status: currentStatus,
        lastCheckAt: new Date().toISOString(),
        consecutiveFailures: 0,
      });

    } catch (err: any) {
      // Se a chamada falhou (servidor offline ou timeout), não sobrescreve QRCODE nem CONNECTED indevidamente
      const health = this.healthMap.get(storeId);
      const failures = (health?.consecutiveFailures || 0) + 1;
      
      this.healthMap.set(storeId, {
        storeId,
        instanceName,
        status: previousState,
        lastCheckAt: new Date().toISOString(),
        consecutiveFailures: failures,
      });
    }
  }

  private async attemptReconnection(instanceName: string, evolutionUrl: string, evolutionKey: string) {
    try {
      await fetch(`${evolutionUrl}/instance/connect/${instanceName}`, {
        headers: { apikey: evolutionKey },
      });
    } catch (err: any) {
      // Ignored
    }
  }

  private async handleStatusChange(
    storeId: string,
    instanceName: string,
    newStatus: HealthStatus,
    previousStatus: HealthStatus,
    reason?: string
  ) {
    if (newStatus !== previousStatus) {
      console.log(`[WhatsappHealthManager] Status change for store ${storeId}: ${previousStatus} -> ${newStatus} (${reason})`);

      // Atualizar banco de dados
      await supabaseAdmin.from("whatsapp_instances").upsert(
        {
          store_id: storeId,
          instance_name: instanceName,
          status: newStatus,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "store_id" }
      );

      // Emitir evento em tempo real para o painel via EventEmitter e WebSockets
      this.emit("instance_status_changed", {
        storeId,
        instanceName,
        previousStatus,
        newStatus,
        timestamp: new Date().toISOString(),
        reason,
      });
    }
  }

  public getStatus(storeId: string): InstanceHealthState | undefined {
    return this.healthMap.get(storeId);
  }
}

export const whatsappHealthManager = WhatsappHealthManager.getInstance();
