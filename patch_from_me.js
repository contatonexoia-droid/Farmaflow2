import fs from 'fs';

let content = fs.readFileSync('services/chatStore.ts', 'utf8');

const target = `      if (existingContact) {
        // Se for uma mensagem enviada por mim ou não tiver pushName novo útil, mantenha o nome existente.
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
      }`;

const replacement = `      if (existingContact) {
        // Se for uma mensagem enviada por mim ou não tiver pushName novo útil, mantenha o nome existente.
        if (fromMe || !msg.pushName) {
          finalContactName = existingContact.name;
        } else {
          finalContactName = pushName;
          await supabaseAdmin.from("chat_contacts").update({
            name: finalContactName,
          }).eq("id", contactId);
        }
      } else {
        if (fromMe) finalContactName = phone; // Fallback se o próprio usuário iniciou a conversa
        await supabaseAdmin.from("chat_contacts").insert([{
          id: contactId,
          store_id: storeId,
          phone_number: phone,
          name: finalContactName,
          created_at: now
        }]);
      }`;

content = content.replace(target, replacement);
fs.writeFileSync('services/chatStore.ts', content);
