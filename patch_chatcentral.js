import fs from 'fs';

let content = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

const targetListTime = `<span className="text-[10px] text-gray-400">10:45</span>`;
const replaceListTime = `<span className="text-[10px] text-gray-400">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>`;
content = content.replace(targetListTime, replaceListTime);

const targetListMsg = `<span className="text-xs text-gray-500 truncate w-3/4">Última mensagem enviada...</span>`;
const replaceListMsg = `<span className="text-xs text-gray-500 truncate w-3/4">{conv.last_message_content || 'Nova conversa'}</span>`;
content = content.replace(targetListMsg, replaceListMsg);

const targetMsgTime = `<span className="text-[10px] text-gray-500 block text-right mt-1">10:50</span>`;
const replaceMsgTime = `<span className="text-[10px] text-gray-500 block text-right mt-1">{msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>`;
content = content.replace(targetMsgTime, replaceMsgTime);

fs.writeFileSync('components/ChatCentral.tsx', content);
