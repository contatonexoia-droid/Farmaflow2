import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value?: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DATA_FILE = path.join(process.cwd(), "inboxes_data.json");

export interface InboxItem {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  whatsapp_instance_id?: string | null;
  channel_type?: string | null;
  channel_mode?: "shared" | "exclusive";
  exclusive_instance_name?: string | null;
  ai_routing_enabled?: boolean;
  is_available_for_routing?: boolean;
  last_routed_at?: string | null;
  created_at: string;
}

function isMissingInboxColumnError(error: any): string | null {
  const msg = String(error?.message || error?.details || "");
  const code = String(error?.code || "");
  if (
    code === "42703" ||
    code === "PGRST204" ||
    /does not exist|Could not find the/i.test(msg)
  ) {
    const m =
      msg.match(/Could not find the '([^']+)' column/i) ||
      msg.match(/column "([^"]+)" of relation "inboxes" does not exist/i) ||
      msg.match(/column inboxes\.([a-zA-Z0-9_]+) does not exist/i);
    return m?.[1] || "__unknown__";
  }
  return null;
}

function isExclusiveInstanceName(name?: string | null): boolean {
  const n = String(name || "").trim().toLowerCase();
  return n.startsWith("inbox_ex_") || n.includes("_excl");
}

interface InboxMemberItem {
  inbox_id: string;
  user_id: string;
}

class InboxStore {
  private inboxes: InboxItem[] = [];
  private members: InboxMemberItem[] = [];

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        this.inboxes = parsed.inboxes || [];
        this.members = parsed.members || [];
      }
    } catch (err) {
      console.warn("[InboxStore] Could not load local file:", err);
    }
  }

  private saveToFile() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        inboxes: this.inboxes,
        members: this.members
      }, null, 2), "utf-8");
    } catch (err) {
      console.warn("[InboxStore] Could not save local file:", err);
    }
  }

  public async getInboxes(storeId: string): Promise<InboxItem[]> {
    let dbInboxes: InboxItem[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        dbInboxes = data.map((d: any) => ({
          ...d,
          channel_type: d.channel_type || "whatsapp"
        }));
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase query error, falling back to memory:", err);
    }

    const fileInboxes = this.inboxes.filter(i => i.store_id === storeId && isValidUuid(i.id));
    const fileById = new Map<string, InboxItem>(fileInboxes.map(fi => [fi.id, fi]));

    // Combine dbInboxes with file metadata (channel_mode, ai_routing_enabled, is_available_for_routing, last_routed_at)
    const dbIds = new Set(dbInboxes.map(i => i.id));
    const merged: InboxItem[] = dbInboxes.map((dbItem) => {
      const fi = fileById.get(dbItem.id);
      return {
        ...dbItem,
        channel_mode: dbItem.channel_mode || fi?.channel_mode,
        exclusive_instance_name: dbItem.exclusive_instance_name || fi?.exclusive_instance_name,
        ai_routing_enabled:
          typeof dbItem.ai_routing_enabled === "boolean"
            ? dbItem.ai_routing_enabled
            : (fi?.ai_routing_enabled ?? false),
        is_available_for_routing:
          typeof dbItem.is_available_for_routing === "boolean"
            ? dbItem.is_available_for_routing
            : (fi?.is_available_for_routing ?? true),
        last_routed_at: dbItem.last_routed_at ?? fi?.last_routed_at ?? null,
      };
    });

    for (const fi of fileInboxes) {
      if (!dbIds.has(fi.id)) {
        merged.push({
          ...fi,
          ai_routing_enabled: fi.ai_routing_enabled ?? false,
          is_available_for_routing: fi.is_available_for_routing ?? true,
          last_routed_at: fi.last_routed_at ?? null,
        });
      }
    }

    if (merged.length === 0) {
      // Cria automaticamente a caixa de entrada principal na tabela inboxes com UUID válido
      const createdDefault = await this.createInbox(
        storeId,
        "Geral / Atendimento",
        "Caixa de entrada principal da loja",
        null,
        "whatsapp"
      );
      return [createdDefault];
    }

    return merged;
  }

  /**
   * Busca o UUID da instância compartilhada/principal mais adequada desta loja em public.whatsapp_instances.
   * Ignora instâncias exclusivas de outras caixas (inbox_ex_* / _excl) para nunca misturar canais exclusivos com o compartilhado.
   */
  public async findStoreConnectedInstanceId(storeId: string): Promise<string | null> {
    if (!storeId) return null;
    try {
      const cleanId = String(storeId).trim().replace(/^store_/, "").replace(/^tenant_/, "");
      const candidateIds = Array.from(new Set([storeId.trim(), cleanId, `store_${cleanId}`].filter(Boolean)));

      const [{ data: allInsts }, { data: storeInboxes }] = await Promise.all([
        supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_name, status, created_at, updated_at")
          .in("store_id", candidateIds)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("inboxes")
          .select("id, whatsapp_instance_id")
          .in("store_id", candidateIds)
      ]);

      if (!allInsts || allInsts.length === 0) return null;

      const refCounts = new Map<string, number>();
      for (const ib of (storeInboxes || [])) {
        if (ib?.whatsapp_instance_id && isValidUuid(ib.whatsapp_instance_id)) {
          refCounts.set(ib.whatsapp_instance_id, (refCounts.get(ib.whatsapp_instance_id) || 0) + 1);
        }
      }

      const validInsts = allInsts.filter((i: any) => isValidUuid(i.id));
      const nonExclusiveInsts = validInsts.filter((i: any) => !isExclusiveInstanceName(i.instance_name));
      const pool = nonExclusiveInsts.length > 0 ? nonExclusiveInsts : validInsts;

      const scoreInst = (i: any): number => {
        let score = 0;
        const name = String(i.instance_name || "").toLowerCase();
        const refs = refCounts.get(i.id) || 0;
        if (i.status === "CONNECTED") score += 1000;
        if (name.startsWith("store_")) score += 300;
        if (refs > 1) score += 200;
        else if (refs === 1) score += 50;
        return score;
      };

      const ranked = [...pool].sort((a, b) => scoreInst(b) - scoreInst(a));
      if (ranked[0]?.id && isValidUuid(ranked[0].id)) {
        return ranked[0].id;
      }
    } catch (err: any) {
      console.warn("[InboxStore] Erro ao buscar instância conectada da loja:", err.message);
    }
    return null;
  }

  /**
   * Garante a criação de uma instância dedicada e única em public.whatsapp_instances
   * para uma caixa de entrada no modo Exclusivo, nunca reutilizando a instância compartilhada da loja.
   */
  public async ensureExclusiveWhatsappInstance(
    storeId: string,
    inboxId: string
  ): Promise<{ instanceId: string; instanceName: string } | null> {
    const cleanInbox = String(inboxId || "")
      .replace(/^inbox_/i, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    const baseSegment = (cleanInbox || crypto.randomBytes(6).toString("hex")).slice(0, 20);
    let candidateName = `inbox_ex_${baseSegment}`;

    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existingByName } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id")
          .eq("instance_name", candidateName)
          .maybeSingle();

        if (!existingByName) {
          break;
        }
        candidateName = `inbox_ex_${baseSegment.slice(0, 14)}_${crypto.randomBytes(3).toString("hex")}`;
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("whatsapp_instances")
        .insert({
          store_id: storeId,
          instance_name: candidateName,
          status: "DISCONNECTED",
          phone_number: null,
          updated_at: new Date().toISOString()
        })
        .select("id, instance_name")
        .single();

      if (!insErr && inserted?.id && isValidUuid(inserted.id)) {
        console.log(
          `[InboxStore] Nova instância exclusiva "${inserted.instance_name}" (${inserted.id}) criada para caixa ${inboxId}`
        );
        return { instanceId: inserted.id, instanceName: inserted.instance_name };
      }
      if (insErr) {
        console.warn("[InboxStore] Aviso ao criar instância exclusiva:", insErr.message);
      }
    } catch (err: any) {
      console.warn("[InboxStore] Exceção ao criar instância exclusiva:", err?.message || err);
    }

    return null;
  }

  public async createInbox(
    storeId: string,
    name: string,
    description?: string,
    whatsappInstanceId?: string | null,
    channelType?: string | null,
    channelMode: "shared" | "exclusive" = "shared",
    routingOptions?: { ai_routing_enabled?: boolean; is_available_for_routing?: boolean }
  ): Promise<InboxItem> {
    const resolvedChannelType = channelType || "whatsapp";
    let validInstId: string | null = isValidUuid(whatsappInstanceId) ? whatsappInstanceId.trim() : null;
    let exclusiveInstanceName: string | null = null;
    const generatedUuid = crypto.randomUUID();
    const aiRoutingEnabled = Boolean(routingOptions?.ai_routing_enabled);
    const isAvailableForRouting = routingOptions?.is_available_for_routing !== false;

    if (resolvedChannelType === "whatsapp") {
      if (channelMode === "exclusive") {
        if (!validInstId) {
          const createdExclusive = await this.ensureExclusiveWhatsappInstance(storeId, generatedUuid);
          if (createdExclusive) {
            validInstId = createdExclusive.instanceId;
            exclusiveInstanceName = createdExclusive.instanceName;
          }
        }
      } else if (!validInstId) {
        // Modo Compartilhado (padrão): vincula automaticamente à instância CONNECTED compartilhada da loja
        validInstId = await this.findStoreConnectedInstanceId(storeId);
      }
    }

    const newInbox: InboxItem = {
      id: generatedUuid,
      store_id: storeId,
      name,
      description: description || "",
      whatsapp_instance_id: validInstId,
      channel_type: resolvedChannelType,
      channel_mode: channelMode,
      ...(exclusiveInstanceName ? { exclusive_instance_name: exclusiveInstanceName } : {}),
      ai_routing_enabled: aiRoutingEnabled,
      is_available_for_routing: isAvailableForRouting,
      last_routed_at: null,
      created_at: new Date().toISOString()
    };

    try {
      const payload: any = {
        id: generatedUuid,
        store_id: storeId,
        name,
        description: description || null,
        whatsapp_instance_id: validInstId,
        ai_routing_enabled: aiRoutingEnabled,
        is_available_for_routing: isAvailableForRouting,
      };

      for (let attempt = 0; attempt < 4; attempt++) {
        const { data, error } = await supabaseAdmin
          .from("inboxes")
          .insert([payload])
          .select()
          .single();

        if (!error && data) {
          const item: InboxItem = {
            ...data,
            channel_type: resolvedChannelType || data.channel_type || "whatsapp",
            channel_mode: channelMode,
            ...(exclusiveInstanceName ? { exclusive_instance_name: exclusiveInstanceName } : {}),
            ai_routing_enabled: typeof data.ai_routing_enabled === "boolean" ? data.ai_routing_enabled : aiRoutingEnabled,
            is_available_for_routing: typeof data.is_available_for_routing === "boolean" ? data.is_available_for_routing : isAvailableForRouting,
            last_routed_at: data.last_routed_at ?? null,
          };
          this.inboxes = this.inboxes.filter(i => i.id !== item.id && isValidUuid(i.id));
          this.inboxes.push(item);
          this.saveToFile();
          return item;
        }
        const missingCol = isMissingInboxColumnError(error);
        if (missingCol) {
          if (missingCol !== "__unknown__" && missingCol in payload) {
            delete payload[missingCol];
          } else {
            delete payload.ai_routing_enabled;
            delete payload.is_available_for_routing;
          }
          continue;
        }
        if (error) {
          console.warn("[InboxStore] Supabase insert warning:", error.message);
          break;
        }
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase insert failed, using fallback:", err);
    }

    this.inboxes = this.inboxes.filter(i => i.id !== newInbox.id && isValidUuid(i.id));
    this.inboxes.push(newInbox);
    this.saveToFile();
    return newInbox;
  }

  public async updateInbox(
    id: string,
    name: string,
    description?: string,
    whatsappInstanceId?: string | null,
    channelType?: string | null,
    options?: {
      storeId?: string;
      channelMode?: "shared" | "exclusive";
      ai_routing_enabled?: boolean;
      is_available_for_routing?: boolean;
    }
  ): Promise<InboxItem> {
    const resolvedChannelType = channelType || "whatsapp";
    const resolvedMode: "shared" | "exclusive" = options?.channelMode === "exclusive" ? "exclusive" : "shared";
    let validInstId: string | null = isValidUuid(whatsappInstanceId) ? whatsappInstanceId.trim() : null;
    let exclusiveInstanceName: string | null = null;

    let effectiveStoreId = options?.storeId;
    if (!effectiveStoreId && isValidUuid(id)) {
      try {
        const { data: existingInbox } = await supabaseAdmin
          .from("inboxes")
          .select("store_id")
          .eq("id", id)
          .maybeSingle();
        if (existingInbox?.store_id) {
          effectiveStoreId = existingInbox.store_id;
        }
      } catch (_) {}
    }

    if (resolvedChannelType === "whatsapp") {
      if (resolvedMode === "exclusive") {
        if (!validInstId) {
          const createdExclusive = await this.ensureExclusiveWhatsappInstance(effectiveStoreId || "default", id);
          if (createdExclusive) {
            validInstId = createdExclusive.instanceId;
            exclusiveInstanceName = createdExclusive.instanceName;
          }
        } else {
          try {
            const { data: chosenInst } = await supabaseAdmin
              .from("whatsapp_instances")
              .select("instance_name")
              .eq("id", validInstId)
              .maybeSingle();
            if (chosenInst?.instance_name) {
              exclusiveInstanceName = chosenInst.instance_name;
            }
          } catch (_) {}
        }
      } else if (!validInstId && effectiveStoreId) {
        validInstId = await this.findStoreConnectedInstanceId(effectiveStoreId);
      }
    }

    const existingLocal = this.inboxes.find(i => i.id === id);
    const resolvedAiRouting =
      options?.ai_routing_enabled !== undefined
        ? Boolean(options.ai_routing_enabled)
        : (existingLocal?.ai_routing_enabled ?? false);
    const resolvedAvailable =
      options?.is_available_for_routing !== undefined
        ? Boolean(options.is_available_for_routing)
        : (existingLocal?.is_available_for_routing ?? true);

    const payload: any = {
      name,
      description: description || "",
      whatsapp_instance_id: validInstId,
      ...(options?.ai_routing_enabled !== undefined ? { ai_routing_enabled: resolvedAiRouting } : {}),
      ...(options?.is_available_for_routing !== undefined ? { is_available_for_routing: resolvedAvailable } : {}),
    };

    if (isValidUuid(id)) {
      try {
        const dbPayload = { ...payload };
        for (let attempt = 0; attempt < 4; attempt++) {
          const { data, error } = await supabaseAdmin
            .from("inboxes")
            .update(dbPayload)
            .eq("id", id)
            .select()
            .single();

          if (!error && data) {
            const updatedItem: InboxItem = {
              ...data,
              channel_type: resolvedChannelType,
              channel_mode: resolvedMode,
              ...(exclusiveInstanceName ? { exclusive_instance_name: exclusiveInstanceName } : {}),
              ai_routing_enabled: typeof data.ai_routing_enabled === "boolean" ? data.ai_routing_enabled : resolvedAiRouting,
              is_available_for_routing: typeof data.is_available_for_routing === "boolean" ? data.is_available_for_routing : resolvedAvailable,
              last_routed_at: data.last_routed_at ?? existingLocal?.last_routed_at ?? null,
            };
            this.inboxes = this.inboxes.some(i => i.id === id)
              ? this.inboxes.map(i => i.id === id ? updatedItem : i)
              : [...this.inboxes, updatedItem];
            this.saveToFile();
            return updatedItem;
          }
          const missingCol = isMissingInboxColumnError(error);
          if (missingCol) {
            if (missingCol !== "__unknown__" && missingCol in dbPayload) {
              delete dbPayload[missingCol];
            } else {
              delete dbPayload.ai_routing_enabled;
              delete dbPayload.is_available_for_routing;
            }
            continue;
          }
          break;
        }
      } catch (err) {
        console.warn("[InboxStore] Supabase update failed, using fallback:", err);
      }
    }

    const localPayload = {
      name,
      description: description || "",
      whatsapp_instance_id: validInstId,
      channel_type: resolvedChannelType,
      channel_mode: resolvedMode,
      ...(exclusiveInstanceName ? { exclusive_instance_name: exclusiveInstanceName } : {}),
      ai_routing_enabled: resolvedAiRouting,
      is_available_for_routing: resolvedAvailable,
      last_routed_at: existingLocal?.last_routed_at ?? null,
    };
    const index = this.inboxes.findIndex(i => i.id === id);
    if (index >= 0) {
      this.inboxes[index] = { ...this.inboxes[index], ...localPayload };
    } else if (isValidUuid(id)) {
      const created = { id, store_id: effectiveStoreId || "default", created_at: new Date().toISOString(), ...localPayload };
      this.inboxes.push(created);
    }
    this.saveToFile();
    return this.inboxes.find(i => i.id === id) || { id, store_id: effectiveStoreId || "default", created_at: new Date().toISOString(), ...localPayload };
  }

  public async updateInboxRoutingSettings(
    id: string,
    updates: {
      storeId?: string;
      ai_routing_enabled?: boolean;
      is_available_for_routing?: boolean;
      last_routed_at?: string | null;
    }
  ): Promise<InboxItem | null> {
    if (!id) return null;

    const dbPatch: Record<string, any> = {};
    if (updates.ai_routing_enabled !== undefined) {
      dbPatch.ai_routing_enabled = Boolean(updates.ai_routing_enabled);
    }
    if (updates.is_available_for_routing !== undefined) {
      dbPatch.is_available_for_routing = Boolean(updates.is_available_for_routing);
    }
    if (updates.last_routed_at !== undefined) {
      dbPatch.last_routed_at = updates.last_routed_at;
    }

    let dbRow: any = null;
    if (isValidUuid(id) && Object.keys(dbPatch).length > 0) {
      try {
        const tryPatch = { ...dbPatch };
        for (let attempt = 0; attempt < 4; attempt++) {
          const { data, error } = await supabaseAdmin
            .from("inboxes")
            .update(tryPatch)
            .eq("id", id)
            .select()
            .single();
          if (!error && data) {
            dbRow = data;
            break;
          }
          const missingCol = isMissingInboxColumnError(error);
          if (missingCol) {
            if (missingCol !== "__unknown__" && missingCol in tryPatch) {
              delete tryPatch[missingCol];
            } else {
              delete tryPatch.ai_routing_enabled;
              delete tryPatch.is_available_for_routing;
              delete tryPatch.last_routed_at;
            }
            if (Object.keys(tryPatch).length === 0) break;
            continue;
          }
          break;
        }
      } catch (err) {
        console.warn("[InboxStore] updateInboxRoutingSettings fallback:", err);
      }
    }

    const index = this.inboxes.findIndex(i => i.id === id);
    if (index >= 0) {
      this.inboxes[index] = {
        ...this.inboxes[index],
        ...(dbRow || {}),
        ...dbPatch,
      };
      this.saveToFile();
      return this.inboxes[index];
    }

    if (dbRow) {
      const merged: InboxItem = { ...dbRow, ...dbPatch };
      this.inboxes.push(merged);
      this.saveToFile();
      return merged;
    }

    if (updates.storeId && isValidUuid(id)) {
      try {
        const { data: existing } = await supabaseAdmin
          .from("inboxes")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (existing) {
          const merged: InboxItem = { ...existing, ...dbPatch };
          this.inboxes.push(merged);
          this.saveToFile();
          return merged;
        }
      } catch (_) {}
    }

    return null;
  }

  public async markInboxRouted(id: string, storeId?: string): Promise<void> {
    await this.updateInboxRoutingSettings(id, {
      storeId,
      last_routed_at: new Date().toISOString(),
    });
  }

  public async deleteInbox(id: string): Promise<boolean> {
    if (isValidUuid(id)) {
      const cleanId = id.trim();

      // Remove acessos órfãos em public.department_access ao excluir a caixa
      try {
        await supabaseAdmin.from("department_access").delete().eq("department_id", cleanId);
      } catch (err) {
        console.warn("[InboxStore] department_access cleanup failed:", err);
      }

      // Remove vínculos legados em inbox_members e inbox_teams
      try {
        await supabaseAdmin.from("inbox_members").delete().eq("inbox_id", cleanId);
      } catch (_) {}
      try {
        await supabaseAdmin.from("inbox_teams").delete().eq("inbox_id", cleanId);
      } catch (_) {}

      try {
        await supabaseAdmin.from("inboxes").delete().eq("id", cleanId);
      } catch (err) {
        console.warn("[InboxStore] Supabase delete failed:", err);
      }
    }

    this.inboxes = this.inboxes.filter(i => i.id !== id);
    this.members = this.members.filter(m => m.inbox_id !== id);
    this.saveToFile();
    return true;
  }

  public async getMembers(inboxId: string): Promise<string[]> {
    if (isValidUuid(inboxId)) {
      try {
        // 1. Try department_access first
        const { data: deptData, error: deptErr } = await supabaseAdmin
          .from("department_access")
          .select("user_id")
          .eq("department_id", inboxId);

        if (!deptErr && deptData && deptData.length > 0) {
          return deptData.map(m => m.user_id).filter(Boolean);
        }

        // 2. Try inbox_members
        const { data, error } = await supabaseAdmin
          .from("inbox_members")
          .select("user_id")
          .eq("inbox_id", inboxId);

        if (!error && data) {
          return data.map(m => m.user_id).filter(Boolean);
        }
      } catch (err) {
        console.warn("[InboxStore] Supabase members query failed:", err);
      }
    }

    return this.members.filter(m => m.inbox_id === inboxId).map(m => m.user_id);
  }

  public async setMembers(inboxId: string, userIds: string[], tenantId?: string): Promise<string[]> {
    const cleanUserIds = Array.from(new Set(userIds.filter(Boolean)));
    
    let activeTenantId = tenantId;
    if (!activeTenantId && isValidUuid(inboxId)) {
      try {
        const { data: inboxInfo } = await supabaseAdmin
          .from("inboxes")
          .select("store_id")
          .eq("id", inboxId)
          .single();
        if (inboxInfo?.store_id) {
          activeTenantId = inboxInfo.store_id;
        }
      } catch (e) {
        console.warn("[InboxStore] Could not fetch store_id for inbox:", inboxId);
      }
    }

    if (isValidUuid(inboxId)) {
      // 1. Update department_access table
      try {
        await supabaseAdmin.from("department_access").delete().eq("department_id", inboxId);
        if (cleanUserIds.length > 0) {
          await supabaseAdmin.from("department_access").insert(
            cleanUserIds.map(uid => ({ 
              department_id: inboxId, 
              user_id: uid, 
              tenant_id: activeTenantId || null,
              created_at: new Date().toISOString() 
            }))
          );
        }
      } catch (err) {
        console.warn("[InboxStore] department_access sync failed:", err);
      }

      // 2. Update inbox_members table
      try {
        await supabaseAdmin.from("inbox_members").delete().eq("inbox_id", inboxId);
        if (cleanUserIds.length > 0) {
          await supabaseAdmin.from("inbox_members").insert(
            cleanUserIds.map(uid => ({ inbox_id: inboxId, user_id: uid }))
          );
        }
      } catch (err) {
        console.warn("[InboxStore] inbox_members sync failed:", err);
      }
    }

    // 3. Update in-memory and local file
    this.members = this.members.filter(m => m.inbox_id !== inboxId);
    cleanUserIds.forEach(uid => {
      this.members.push({ inbox_id: inboxId, user_id: uid });
    });
    this.saveToFile();

    return cleanUserIds;
  }

  public async toggleMember(inboxId: string, userId: string): Promise<string[]> {
    let current = await this.getMembers(inboxId);
    const exists = current.includes(userId);
    const updated = exists ? current.filter(id => id !== userId) : [...current, userId];
    return this.setMembers(inboxId, updated);
  }
}

export const inboxStore = new InboxStore();
