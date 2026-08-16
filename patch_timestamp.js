import fs from 'fs';

let content = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

const target1 = `    const tempMsg = {
      id: \`temp_\${Date.now()}\`,
      conversation_id: selectedConversation.id,
      sender_type: 'USER',
      content: textToSend,
      is_private: isPrivateNote,
      created_at: new Date().toISOString()
    };`;

const replacement1 = `    const tempMsg = {
      id: \`temp_\${Date.now()}\`,
      conversation_id: selectedConversation.id,
      sender_type: 'USER',
      content: textToSend,
      is_private: isPrivateNote,
      created_at: new Date().toISOString()
    };`;

// Also check the temp message update logic
const target2 = `          setSelectedConversation((prev: any) => prev ? { ...prev, last_message_content: textToSend, last_message_at: new Date().toISOString() } : prev);`;
const replacement2 = `          setSelectedConversation((prev: any) => prev ? { ...prev, last_message_content: textToSend, last_message_at: new Date().toISOString() } : prev);`;

content = content.replace(target1, replacement1);
content = content.replace(target2, replacement2);
fs.writeFileSync('components/ChatCentral.tsx', content);
