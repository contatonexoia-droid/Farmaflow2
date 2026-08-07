import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export class ContactMergeManager {
  private static instance: ContactMergeManager;

  private constructor() {}

  public static getInstance(): ContactMergeManager {
    if (!ContactMergeManager.instance) {
      ContactMergeManager.instance = new ContactMergeManager();
    }
    return ContactMergeManager.instance;
  }

  /**
   * Unifica registros duplicados consolidando histórico de pedidos, conversas, mensagens e endereços
   */
  public async mergeContacts(targetContactId: string, sourceContactId: string) {
    console.log(`[ContactMergeManager] Merging contact ${sourceContactId} into target ${targetContactId}...`);

    try {
      // 1. Buscar ambos os contatos
      const { data: targetContact } = await supabaseAdmin
        .from("contacts")
        .select("*")
        .eq("id", targetContactId)
        .single();

      const { data: sourceContact } = await supabaseAdmin
        .from("contacts")
        .select("*")
        .eq("id", sourceContactId)
        .single();

      if (!targetContact || !sourceContact) {
        throw new Error("Target or Source contact not found.");
      }

      // 2. Mesclar custom_attributes
      const mergedAttributes = {
        ...(sourceContact.custom_attributes || {}),
        ...(targetContact.custom_attributes || {}), // Target prevalece se houver conflito
      };

      await supabaseAdmin
        .from("contacts")
        .update({
          custom_attributes: mergedAttributes,
          notes: `${targetContact.notes || ""}\n[Merged from ${sourceContact.phone}]: ${sourceContact.notes || ""}`.trim(),
        })
        .eq("id", targetContactId);

      // 3. Re-vincular conversas de chat do contato origem para o contato destino
      await supabaseAdmin
        .from("chat_conversations")
        .update({ contact_id: targetContactId })
        .eq("contact_id", sourceContactId);

      // 4. Re-vincular pedidos do telefone do contato origem para o telefone do contato destino
      if (sourceContact.phone && targetContact.phone) {
        await supabaseAdmin
          .from("orders")
          .update({ phone: targetContact.phone })
          .eq("phone", sourceContact.phone)
          .eq("tenant_id", targetContact.store_id);
      }

      // 5. Excluir ou arquivar o contato de origem unificado
      await supabaseAdmin
        .from("contacts")
        .delete()
        .eq("id", sourceContactId);

      console.log(`[ContactMergeManager] Successfully merged contact ${sourceContactId} into ${targetContactId}`);
      return { success: true, targetContactId, sourceContactId };
    } catch (err: any) {
      console.error("[ContactMergeManager] Error during contact merge:", err);
      throw err;
    }
  }
}

export const contactMergeManager = ContactMergeManager.getInstance();
