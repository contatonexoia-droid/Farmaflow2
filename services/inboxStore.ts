import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DATA_FILE = path.join(process.cwd(), "inboxes_data.json");

interface InboxItem {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  whatsapp_instance_id?: string | null;
  channel_type?: string | null;
  created_at: string;
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

    const fileInboxes = this.inboxes.filter(i => i.store_id === storeId);
    
    // Combine dbInboxes with any file inboxes that aren't yet in dbInboxes
    const dbIds = new Set(dbInboxes.map(i => i.id));
    const merged = [...dbInboxes];
    for (const fi of fileInboxes) {
      if (!dbIds.has(fi.id)) {
        merged.push(fi);
      }
    }

    if (merged.length === 0) {
      // Create default inbox
      const defaultInbox: InboxItem = {
        id: `inbox_default_${storeId}`,
        store_id: storeId,
        name: "Geral / Atendimento",
        description: "Caixa de entrada principal da loja",
        whatsapp_instance_id: null,
        channel_type: "whatsapp",
        created_at: new Date().toISOString()
      };
      this.inboxes.push(defaultInbox);
      this.saveToFile();
      return [defaultInbox];
    }

    return merged;
  }

  public async createInbox(storeId: string, name: string, description?: string, whatsappInstanceId?: string | null, channelType?: string | null): Promise<InboxItem> {
    const isUuid = whatsappInstanceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(whatsappInstanceId);
    const validInstId = isUuid ? whatsappInstanceId : null;

    const newInbox: InboxItem = {
      id: `inbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      store_id: storeId,
      name,
      description: description || "",
      whatsapp_instance_id: validInstId,
      channel_type: channelType || "whatsapp",
      created_at: new Date().toISOString()
    };

    try {
      // First try inserting clean payload
      const payload: any = {
        store_id: storeId,
        name,
        description: description || null,
        whatsapp_instance_id: validInstId
      };

      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .insert([payload])
        .select()
        .single();

      if (!error && data) {
        const item: InboxItem = {
          ...data,
          channel_type: channelType || data.channel_type || "whatsapp"
        };
        this.inboxes.push(item);
        this.saveToFile();
        return item;
      }
      if (error) {
        console.warn("[InboxStore] Supabase insert warning:", error.message);
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase insert failed, using fallback:", err);
    }

    this.inboxes.push(newInbox);
    this.saveToFile();
    return newInbox;
  }

  public async updateInbox(id: string, name: string, description?: string, whatsappInstanceId?: string | null, channelType?: string | null): Promise<InboxItem> {
    const isUuid = whatsappInstanceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(whatsappInstanceId);
    const validInstId = isUuid ? whatsappInstanceId : null;

    const payload: any = {
      name,
      description: description || "",
      whatsapp_instance_id: validInstId
    };

    try {
      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (!error && data) {
        const updatedItem = { ...data, channel_type: channelType || "whatsapp" };
        this.inboxes = this.inboxes.map(i => i.id === id ? updatedItem : i);
        this.saveToFile();
        return updatedItem;
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase update failed, using fallback:", err);
    }

    const localPayload = { ...payload, channel_type: channelType || "whatsapp" };
    const index = this.inboxes.findIndex(i => i.id === id);
    if (index >= 0) {
      this.inboxes[index] = { ...this.inboxes[index], ...localPayload };
    } else {
      const created = { id, store_id: "default", created_at: new Date().toISOString(), ...localPayload };
      this.inboxes.push(created);
    }
    this.saveToFile();
    return this.inboxes.find(i => i.id === id) || { id, store_id: "default", created_at: new Date().toISOString(), ...localPayload };
  }

  public async deleteInbox(id: string): Promise<boolean> {
    try {
      await supabaseAdmin.from("inboxes").delete().eq("id", id);
    } catch (err) {
      console.warn("[InboxStore] Supabase delete failed:", err);
    }

    this.inboxes = this.inboxes.filter(i => i.id !== id);
    this.members = this.members.filter(m => m.inbox_id !== id);
    this.saveToFile();
    return true;
  }

  public async getMembers(inboxId: string): Promise<string[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("inbox_members")
        .select("user_id")
        .eq("inbox_id", inboxId);

      if (!error && data) {
        return data.map(m => m.user_id);
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase members query failed:", err);
    }

    return this.members.filter(m => m.inbox_id === inboxId).map(m => m.user_id);
  }

  public async toggleMember(inboxId: string, userId: string): Promise<string[]> {
    let current = await this.getMembers(inboxId);
    const exists = current.includes(userId);

    if (exists) {
      const { error } = await supabaseAdmin.from("inbox_members").delete().match({ inbox_id: inboxId, user_id: userId });
      if (error) throw new Error(error.message);
      this.members = this.members.filter(m => !(m.inbox_id === inboxId && m.user_id === userId));
    } else {
      const { error } = await supabaseAdmin.from("inbox_members").insert([{ inbox_id: inboxId, user_id: userId }]);
      if (error) throw new Error(error.message);
      this.members.push({ inbox_id: inboxId, user_id: userId });
    }

    this.saveToFile();
    return this.getMembers(inboxId);
  }
}

export const inboxStore = new InboxStore();
