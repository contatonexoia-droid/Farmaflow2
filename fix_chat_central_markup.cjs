const fs = require('fs');
let code = fs.readFileSync('components/ChatCentral.tsx', 'utf8');

const targetSnippet = `                <div className="flex items-center justify-between gap-2 mb-2">
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
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 bg-white rounded-xl border border-gray-300 shadow-sm flex items-end p-1 relative">
                    {/* Canned Responses Autocomplete Overlay */}
                    {isCannedDropdownOpen && filteredCanned.length > 0 && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                        <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider flex justify-between">
                          <span>Respostas Rápidas</span>
                          <span>Navegue com ↑↓ e pressione Enter</span>
                        </div>`;

// Replace from '<div className="flex items-center justify-between gap-2 mb-2">' up to '{filteredCanned.map'
const searchPattern = /<div className="flex items-center justify-between gap-2 mb-2">[\s\S]*?{filteredCanned\.map/;
code = code.replace(searchPattern, `${targetSnippet}\n                        {filteredCanned.map`);

fs.writeFileSync('components/ChatCentral.tsx', code);
console.log('Fixed markup in ChatCentral.tsx');
