import fs from 'fs';

let content = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

const targetListTime = `<span className="text-[10px] text-gray-400">
                    {conv.last_message_at 
                      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) 
                      : ''}
                  </span>`;

const replaceListTime = `<span className="text-[10px] text-gray-400">
                    {conv.last_message_at 
                      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
                      : ''}
                  </span>`;
                    
content = content.replace(targetListTime, replaceListTime);
fs.writeFileSync('components/ChatCentral.tsx', content);
