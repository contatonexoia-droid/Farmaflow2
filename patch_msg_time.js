import fs from 'fs';

let content = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

const targetMsgTime = `<span className="text-[10px] text-gray-500 block text-right mt-1">
                      {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''}
                    </span>`;

const replaceMsgTime = `<span className="text-[10px] text-gray-500 block text-right mt-1">
                      {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>`;
                    
content = content.replace(targetMsgTime, replaceMsgTime);
fs.writeFileSync('components/ChatCentral.tsx', content);
