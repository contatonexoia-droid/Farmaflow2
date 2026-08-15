const fs = require('fs');
let code = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

// 1. Add import
if (!code.includes('AiChatCopilot')) {
  code = code.replace(
    "import { ChatTransferModal } from './ChatTransferModal';",
    "import { ChatTransferModal } from './ChatTransferModal';\nimport { AiChatCopilot } from './AiChatCopilot';"
  );
}

// 2. Add Copilot in the input toolbar
const oldHeader = `<div className="flex items-center gap-2 mb-2">
                  <button 
                    onClick={() => setIsPrivateNote(false)}
                    className={\`px-3 py-1.5 rounded-lg text-xs font-bold transition-all \${!isPrivateNote ? 'bg-emerald-100 text-emerald-700' : 'text-gray-500 hover:bg-gray-200'}\`}
                  >
                    <MessageSquare className="w-3 h-3 inline mr-1" /> Cliente
                  </button>
                  <button 
                    onClick={() => setIsPrivateNote(true)}
                    className={\`px-3 py-1.5 rounded-lg text-xs font-bold transition-all \${isPrivateNote ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-200'}\`}
                  >
                    <Lock className="w-3 h-3 inline mr-1" /> Interna
                  </button>
                </div>`;

const newHeader = `<div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsPrivateNote(false)}
                      className={\`px-3 py-1.5 rounded-lg text-xs font-bold transition-all \${!isPrivateNote ? 'bg-emerald-100 text-emerald-700' : 'text-gray-500 hover:bg-gray-200'}\`}
                    >
                      <MessageSquare className="w-3 h-3 inline mr-1" /> Cliente
                    </button>
                    <button 
                      onClick={() => setIsPrivateNote(true)}
                      className={\`px-3 py-1.5 rounded-lg text-xs font-bold transition-all \${isPrivateNote ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-200'}\`}
                    >
                      <Lock className="w-3 h-3 inline mr-1" /> Interna
                    </button>
                  </div>
                  
                  {/* Assistente de IA para Atendentes (Copilot) */}
                  <AiChatCopilot
                    tenantId={tenantId}
                    currentMessage={messageInput}
                    onApplyText={(newText) => setMessageInput(newText)}
                    disabled={!!otherUserViewing}
                  />
                </div>`;

if (code.includes('setIsPrivateNote(false)')) {
  // Replace the block
  code = code.replace(/<div className="flex items-center gap-2 mb-2">[\s\S]*?<\/div>[\s\S]*?<\/div>/, (match) => {
    if (match.includes('setIsPrivateNote(true)')) {
      return newHeader;
    }
    return match;
  });
}

fs.writeFileSync('components/ChatCentral.tsx', code);
console.log('ChatCentral.tsx updated with AiChatCopilot');
