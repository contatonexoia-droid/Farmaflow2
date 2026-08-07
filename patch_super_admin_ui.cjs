const fs = require('fs');
let content = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

const target = `                    </div>
                </div>

                <div className="flex justify-end gap-4 mt-10">`;

const replacement = `                    </div>
                </div>

                <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare size={16} className="text-indigo-700" />
                      <span className="text-[11px] font-black text-indigo-700 uppercase tracking-widest">Add-ons e Módulos</span>
                    </div>
                    
                    <label className="flex items-center gap-4 cursor-pointer group bg-white p-4 rounded-2xl border-2 border-indigo-100 hover:border-indigo-300 transition-colors">
                        <div className="relative">
                            <input type="checkbox" className="sr-only" checked={editData.isChatEnabled || false} onChange={e => setEditData({...editData, isChatEnabled: e.target.checked})} />
                            <div className={\`block w-14 h-8 rounded-full transition-colors \${editData.isChatEnabled ? 'bg-indigo-500' : 'bg-gray-300'}\`}></div>
                            <div className={\`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform \${editData.isChatEnabled ? 'transform translate-x-6' : ''}\`}></div>
                        </div>
                        <div>
                            <p className="font-bold text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">Módulo de Chat Multi-Atendentes</p>
                            <p className="text-xs text-gray-500">Ativa a interface de Chat e a conexão com WhatsApp via Z-API para esta loja.</p>
                        </div>
                    </label>
                </div>

                <div className="flex justify-end gap-4 mt-10">`;

if (content.includes('Módulo de Chat Multi-Atendentes')) {
  console.log("Already added");
} else {
  content = content.replace(target, replacement);
  fs.writeFileSync('components/SuperAdminManager.tsx', content);
  console.log("Added Chat toggle UI");
}
