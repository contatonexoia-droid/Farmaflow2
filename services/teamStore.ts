import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DATA_FILE = path.join(process.cwd(), "teams_data.json");

interface TeamItem {
  id: string;
  store_id: string;
  name: string;
  description?: string;
  created_at: string;
}

interface TeamMemberItem {
  team_id: string;
  user_id: string;
}

interface InboxTeamItem {
  inbox_id: string;
  team_id: string;
}

class TeamStore {
  private teams: TeamItem[] = [];
  private members: TeamMemberItem[] = [];
  private inboxTeams: InboxTeamItem[] = [];

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        this.teams = parsed.teams || [];
        this.members = parsed.members || [];
        this.inboxTeams = parsed.inboxTeams || [];
      }
    } catch (err) {
      console.warn("[TeamStore] Could not load local file:", err);
    }
  }

  private saveToFile() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        teams: this.teams,
        members: this.members,
        inboxTeams: this.inboxTeams
      }, null, 2), "utf-8");
    } catch (err) {
      console.warn("[TeamStore] Could not save local file:", err);
    }
  }

  public async getTeams(storeId: string): Promise<TeamItem[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_teams")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        return data;
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase getTeams error, falling back to memory:", err);
    }

    return this.teams.filter(t => t.store_id === storeId);
  }

  public async createTeam(storeId: string, name: string, description?: string): Promise<TeamItem> {
    const newTeam: TeamItem = {
      id: `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      store_id: storeId,
      name,
      description: description || "",
      created_at: new Date().toISOString()
    };

    try {
      const { data, error } = await supabaseAdmin
        .from("chat_teams")
        .insert([newTeam])
        .select()
        .single();

      if (!error && data) {
        this.teams.push(data);
        this.saveToFile();
        return data;
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase createTeam error, using memory fallback:", err);
    }

    this.teams.push(newTeam);
    this.saveToFile();
    return newTeam;
  }

  public async updateTeam(id: string, name: string, description?: string): Promise<TeamItem> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_teams")
        .update({ name, description })
        .eq("id", id)
        .select()
        .single();

      if (!error && data) {
        this.teams = this.teams.map(t => t.id === id ? data : t);
        this.saveToFile();
        return data;
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase updateTeam error, using memory fallback:", err);
    }

    this.teams = this.teams.map(t => {
      if (t.id === id) {
        return { ...t, name, description: description || "" };
      }
      return t;
    });
    this.saveToFile();
    return this.teams.find(t => t.id === id)!;
  }

  public async deleteTeam(id: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("chat_teams")
        .delete()
        .eq("id", id);

      if (!error) {
        this.teams = this.teams.filter(t => t.id !== id);
        this.members = this.members.filter(m => m.team_id !== id);
        this.inboxTeams = this.inboxTeams.filter(it => it.team_id !== id);
        this.saveToFile();
        return true;
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase deleteTeam error, using memory fallback:", err);
    }

    this.teams = this.teams.filter(t => t.id !== id);
    this.members = this.members.filter(m => m.team_id !== id);
    this.inboxTeams = this.inboxTeams.filter(it => it.team_id !== id);
    this.saveToFile();
    return true;
  }

  public async getMembers(teamId: string): Promise<string[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_team_members")
        .select("user_id")
        .eq("team_id", teamId);

      if (!error && data) {
        return data.map((r: any) => r.user_id);
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase getMembers error, falling back to memory:", err);
    }

    return this.members.filter(m => m.team_id === teamId).map(m => m.user_id);
  }

  public async toggleMember(teamId: string, userId: string): Promise<string[]> {
    try {
      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from("chat_team_members")
        .select("id")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!fetchErr) {
        if (existing) {
          await supabaseAdmin.from("chat_team_members").delete().eq("id", existing.id);
        } else {
          await supabaseAdmin.from("chat_team_members").insert({ team_id: teamId, user_id: userId });
        }

        const { data: finalMembers, error: finalErr } = await supabaseAdmin
          .from("chat_team_members")
          .select("user_id")
          .eq("team_id", teamId);

        if (!finalErr && finalMembers) {
          const userIds = finalMembers.map((m: any) => m.user_id);
          this.members = this.members.filter(m => !(m.team_id === teamId && m.user_id === userId));
          if (!existing) {
            this.members.push({ team_id: teamId, user_id: userId });
          }
          this.saveToFile();
          return userIds;
        }
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase toggleMember error, using memory fallback:", err);
    }

    const isMember = this.members.some(m => m.team_id === teamId && m.user_id === userId);
    if (isMember) {
      this.members = this.members.filter(m => !(m.team_id === teamId && m.user_id === userId));
    } else {
      this.members.push({ team_id: teamId, user_id: userId });
    }
    this.saveToFile();
    return this.members.filter(m => m.team_id === teamId).map(m => m.user_id);
  }

  public async getInboxTeams(inboxId: string): Promise<string[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("inbox_teams")
        .select("team_id")
        .eq("inbox_id", inboxId);

      if (!error && data) {
        return data.map((r: any) => r.team_id);
      }
    } catch (err) {
      console.warn("[TeamStore] Supabase getInboxTeams error, falling back to memory:", err);
    }

    return this.inboxTeams.filter(it => it.inbox_id === inboxId).map(it => it.team_id);
  }

  public async setInboxTeams(inboxId: string, teamIds: string[]): Promise<string[]> {
    try {
      await supabaseAdmin
        .from("inbox_teams")
        .delete()
        .eq("inbox_id", inboxId);

      if (teamIds.length > 0) {
        const rows = teamIds.map(teamId => ({
          inbox_id: inboxId,
          team_id: teamId
        }));
        await supabaseAdmin.from("inbox_teams").insert(rows);
      }

      this.inboxTeams = this.inboxTeams.filter(it => it.inbox_id !== inboxId);
      teamIds.forEach(teamId => {
        this.inboxTeams.push({ inbox_id: inboxId, team_id: teamId });
      });
      this.saveToFile();
      return teamIds;
    } catch (err) {
      console.warn("[TeamStore] Supabase setInboxTeams error, using memory fallback:", err);
    }

    this.inboxTeams = this.inboxTeams.filter(it => it.inbox_id !== inboxId);
    teamIds.forEach(teamId => {
      this.inboxTeams.push({ inbox_id: inboxId, team_id: teamId });
    });
    this.saveToFile();
    return teamIds;
  }

  public getTeamsForUser(userId: string): string[] {
    return this.members.filter(m => m.user_id === userId).map(m => m.team_id);
  }

  public getInboxesForTeams(teamIds: string[]): string[] {
    return this.inboxTeams.filter(it => teamIds.includes(it.team_id)).map(it => it.inbox_id);
  }
}

export const teamStore = new TeamStore();
