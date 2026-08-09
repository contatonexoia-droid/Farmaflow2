import fs from 'fs';
let content = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

content = content.replace(
  /toLocaleTimeString\('pt-BR', \{ hour: '2-digit', minute: '2-digit' \}\)/g,
  "toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })"
);

fs.writeFileSync('components/ChatCentral.tsx', content);
