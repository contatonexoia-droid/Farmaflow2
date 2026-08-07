const fs = require('fs');
let content = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

content = content.replace(
  'isBlocked: false,',
  'isBlocked: false, \n    isChatEnabled: false,'
);

content = content.replace(
  'isBlocked: editData.isBlocked || false,',
  'isBlocked: editData.isBlocked || false,\n          isChatEnabled: editData.isChatEnabled || false,'
);

content = content.replace(
  /isBlocked: false, licenseExpiration:/,
  'isBlocked: false, isChatEnabled: false, licenseExpiration:'
);

const featureFlagUI = `
                            </div>
                            <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border-2 border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors group">
                              <div className="relative">
                                <input type="checkbox" className="sr-only" checked={editData.isChatEnabled || false} onChange={e => setEditData({...editData, isChatEnabled: e.target.checked})} />
                                <div className={\`block w-14 h-8 rounded-full transition-colors \${editData.isChatEnabled ? 'bg-emerald-500' : 'bg-gray-300'}\`}></div>
                                <div className={\`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform \${editData.isChatEnabled ? 'transform translate-x-6' : ''}\`}></div>
                              </div>
                              <div>
                                <p className="font-bold text-gray-900 text-sm group-hover:text-emerald-700 transition-colors">Módulo de Chat</p>
                                <p className="text-xs text-gray-500">Ativa o add-on de Atendimento/Chat na loja.</p>
                              </div>
                            </label>
                          </div>
                        </div>
`;

// we need to find a place to put the feature flag UI.
// let's look for "isBlocked" UI or similar, or just append it to the configuration block.
