import fs from 'fs';

let content = fs.readFileSync('services/chatStore.ts', 'utf8');

const target = `    // Try Supabase insert
    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: msgUuid,
        conversation_id: conversationId,
        sender_type: senderType,
        content,
        is_private: isPrivate,
        media_url: mediaUrl,
        media_type: mediaType,
        created_at: now
      }]);

      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir mensagem no addMessage', error.message, error);
      }`;

const replacement = `    // Evolution API Dispatch (for USER/BOT messages, if not private)
    if ((senderType === "USER" || senderType === "BOT") && !isPrivate) {
      try {
        // 1. Get instance name
        const { data: instData } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("store_id", storeId)
          .maybeSingle();

        // 2. Get customer phone
        const { data: convData } = await supabaseAdmin
          .from("chat_conversations")
          .select("contact_id")
          .eq("id", conversationId)
          .maybeSingle();
        
        let phoneToSend = null;
        if (convData?.contact_id) {
          const { data: contactData } = await supabaseAdmin
            .from("chat_contacts")
            .select("phone_number")
            .eq("id", convData.contact_id)
            .maybeSingle();
          if (contactData?.phone_number) phoneToSend = contactData.phone_number;
        }

        if (instData?.instance_name && phoneToSend) {
          const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\\/$/, "");
          const evoKey = process.env.EVOLUTION_API_KEY;
          
          if (evoUrl && evoKey) {
            const sendUrl = \`\${evoUrl}/message/sendText/\${instData.instance_name}\`;
            // Add suffix if missing
            const remoteJid = phoneToSend.includes("@s.whatsapp.net") ? phoneToSend : \`\${phoneToSend}@s.whatsapp.net\`;
            
            const payload = {
              number: remoteJid,
              text: content
            };

            fetch(sendUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': evoKey
              },
              body: JSON.stringify(payload)
            }).then(async res => {
               if (!res.ok) {
                 const errText = await res.text();
                 console.error('[EVOLUTION API ERROR] Failed to send message:', errText);
               } else {
                 console.log('[EVOLUTION API] Message sent successfully to', remoteJid);
               }
            }).catch(e => console.error('[EVOLUTION API ERROR] Network error:', e));
          } else {
             console.error('[EVOLUTION API] Missing URL or Key in environment variables');
          }
        } else {
          console.error('[EVOLUTION API] Missing instance_name or phone_number to send message. instance:', instData?.instance_name, 'phone:', phoneToSend);
        }
      } catch (evoErr) {
        console.error('[EVOLUTION API] Exception preparing to send message:', evoErr);
      }
    }

    // Try Supabase insert
    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: msgUuid,
        conversation_id: conversationId,
        sender_type: senderType,
        content,
        is_private: isPrivate,
        media_url: mediaUrl,
        media_type: mediaType,
        created_at: now
      }]);

      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir mensagem no addMessage', error.message, error);
      }`;

content = content.replace(target, replacement);
fs.writeFileSync('services/chatStore.ts', content);
