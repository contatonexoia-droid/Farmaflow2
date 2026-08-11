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
    try {
      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        return data;
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase query error, falling back to memory:", err);
    }

    // Fallback to memory/file store
    const storeInboxes = this.inboxes.filter(i => i.store_id === storeId);
    if (storeInboxes.length === 0) {
      // Create default
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
    return storeInboxes;
  }

  public async createInbox(storeId: string, name: string, description?: string, whatsappInstanceId?: string | null, channelType?: string | null): Promise<InboxItem> {
    const newInbox: InboxItem = {
      id: `inbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      store_id: storeId,
      name,
      description: description || "",
      whatsapp_instance_id: whatsappInstanceId || null,
      channel_type: channelType || "whatsapp",
      created_at: new Date().toISOString()
    };

    try {
      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .insert([{
          store_id: storeId,
          name,
          description: description || null,
          whatsapp_instance_id: whatsappInstanceId || null,
          channel_type: channelType || "whatsapp"
        }])
        .select()
        .single();

      if (!error && data) {
        this.inboxes.push(data);
        this.saveToFile();
        return data;
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase insert failed, using fallback:", err);
    }

    this.inboxes.push(newInbox);
    this.saveToFile();
    return newInbox;
  }

  public async updateInbox(id: string, name: string, description?: string, whatsappInstanceId?: string | null, channelType?: string | null): Promise<InboxItem> {
    const payload = {
      name,
      description: description || "",
      whatsapp_instance_id: whatsappInstanceId || null,
      channel_type: channelType || "whatsapp"
    };

    try {
      const { data, error } = await supabaseAdmin
        .from("inboxes")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (!error && data) {
        this.inboxes = this.inboxes.map(i => i.id === id ? data : i);
        this.saveToFile();
        return data;
      }
    } catch (err) {
      console.warn("[InboxStore] Supabase update failed, using fallback:", err);
    }

    const index = this.inboxes.findIndex(i => i.id === id);
    if (index >= 0) {
      this.inboxes[index] = { ...this.inboxes[index], ...payload };
    } else {
      const created = { id, store_id: "default", created_at: new Date().toISOString(), ...payload };
      this.inboxes.push(created);
    }
    this.saveToFile();
    return this.inboxes.find(i => i.id === id) || { id, store_id: "default", created_at: new Date().toISOString(), ...payload };
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
