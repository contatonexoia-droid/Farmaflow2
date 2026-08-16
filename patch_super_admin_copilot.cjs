const fs = require('fs');
let code = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

// 1. Initial editData state
code = code.replace(
  'isAiAgentEnabled: false,',
  'isAiAgentEnabled: false,\n    isAiCopilotEnabled: false,'
);

// 2. handleEditTenant mapping
code = code.replace(
  'isAiAgentEnabled: tenant.isAiAgentEnabled || false,',
  'isAiAgentEnabled: tenant.isAiAgentEnabled || tenant.is_ai_agent_enabled || false,\n      isAiCopilotEnabled: tenant.isAiCopilotEnabled || tenant.is_ai_copilot_enabled || false,'
);

// 3. handleSave mapping
code = code.replace(
  'isAiAgentEnabled: editData.isAiAgentEnabled || false,',
  'isAiAgentEnabled: editData.isAiAgentEnabled || false,\n          isAiCopilotEnabled: editData.isAiCopilotEnabled || false,'
);

// 4. List badge
if (!code.includes('Copilot Atendentes')) {
  code = code.replace(
    `{t.isAiAgentEnabled && (
                          <span className="flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md font-extrabold text-[9px]">
                            <Sparkles size={10} /> IA Habilitada
                          </span>
                        )}`,
    `{t.isAiAgentEnabled && (
                          <span className="flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md font-extrabold text-[9px]">
                            <Bot size={10} /> Bot IA
                          </span>
                        )}
                        {(t.isAiCopilotEnabled || t.is_ai_copilot_enabled) && (
                          <span className="flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md font-extrabold text-[9px]">
                            <Sparkles size={10} /> Copilot IA
                          </span>
                        )}`
  );
}

// 5. Add Master Switch in Edit Dialog
const copilotSwitch = `                    {/* Master Switch para o Assistente de IA dos Atendentes (Copilot) */}
                    <label className="flex items-center gap-4 cursor-pointer group bg-gradient-to-r from-blue-50 via-indigo-50/50 to-purple-50 p-4 rounded-2xl border-2 border-indigo-200 hover:border-indigo-400 transition-all shadow-sm">
                        <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only" 
                              checked={editData.isAiCopilotEnabled || false} 
                              onChange={e => setEditData({...editData, isAiCopilotEnabled: e.target.checked})} 
                            />
                            <div className={\`block w-14 h-8 rounded-full transition-colors \${editData.isAiCopilotEnabled ? 'bg-indigo-600' : 'bg-gray-300'}\`}></div>
                            <div className={\`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform \${editData.isAiCopilotEnabled ? 'transform translate-x-6' : ''}\`}></div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="p-1 rounded-lg bg-indigo-100 text-indigo-700"><Sparkles size={16} /></span>
                                <p className="font-bold text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">Módulo de Assistente de IA para Atendentes (Co-piloto do Chat)</p>
                                <span className="text-[9px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Upgrade / Plano PRO</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Habilita as ferramentas de IA na tela de chat para os operadores corrigirem textos, ajustarem o tom para empático, resumirem ou criarem respostas a partir de tópicos.</p>
                        </div>
                    </label>
`;

if (!code.includes('Módulo de Assistente de IA para Atendentes')) {
  code = code.replace(
    `{/* Master Switch para o Agente de IA */}`,
    `${copilotSwitch}\n                    {/* Master Switch para o Agente de IA */}`
  );
}

fs.writeFileSync('components/SuperAdminManager.tsx', code);
console.log('SuperAdminManager.tsx updated successfully');
