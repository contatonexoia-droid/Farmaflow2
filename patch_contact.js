import fs from 'fs';

let content = fs.readFileSync('services/chatStore.ts', 'utf8');

const target = `    const contact: ChatContact = {
      id: contactId,
      store_id: storeId,
      name: pushName,
      phone_number: phone,
      created_at: now
    };

    // 1. Busca ou criação do contato (chat_contacts)
    try {
      const { error } = await supabaseAdmin.from("chat_contacts").upsert([{
        id: contactId,
        store_id: storeId,
        phone_number: phone,
        name: pushName,
        created_at: now
      }], { onConflict: "id" });
      
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao buscar ou criar contato (chat_contacts)', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar ou criar contato (chat_contacts)', error.message, error.stack);
    }`;

const replacement = `    // 1. Busca ou criação do contato (chat_contacts)
    let finalContactName = pushName;
    try {
      const { data: existingContact } = await supabaseAdmin
        .from("chat_contacts")
        .select("name")
        .eq("id", contactId)
        .maybeSingle();

      if (existingContact) {
        if (fromMe || !msg.pushName) {
          finalContactName = existingContact.name;
        } else {
          finalContactName = pushName;
        }
        await supabaseAdmin.from("chat_contacts").update({
          name: finalContactName,
        }).eq("id", contactId);
      } else {
        if (fromMe) finalContactName = phone;
        await supabaseAdmin.from("chat_contacts").insert([{
          id: contactId,
          store_id: storeId,
          phone_number: phone,
          name: finalContactName,
          created_at: now
        }]);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar ou criar contato (chat_contacts)', error.message, error.stack);
    }
    
    const contact: ChatContact = {
      id: contactId,
      store_id: storeId,
      name: finalContactName,
      phone_number: phone,
      created_at: now
    };`;

content = content.replace(target, replacement);
fs.writeFileSync('services/chatStore.ts', content);
