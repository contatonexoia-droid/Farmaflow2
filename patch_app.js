const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

// Mobile sidebar
content = content.replace(
  '<Users size={20} />\n                        Equipe\n                      </button>',
  '<Users size={20} />\n                        Equipe\n                      </button>\n                      <button\n                        onClick={() => {\n                          setAdminTab("inboxes");\n                          setIsSidebarOpen(false);\n                        }}\n                        className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "inboxes" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}`}\n                      >\n                        <Inbox size={20} />\n                        Departamentos\n                      </button>'
);

// Desktop sidebar
content = content.replace(
  '<Users size={18} />\n                      Equipe\n                    </button>',
  '<Users size={18} />\n                      Equipe\n                    </button>\n                    <button\n                      onClick={() => setAdminTab("inboxes")}\n                      className={`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 ${adminTab === "inboxes" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}`}\n                      style={adminTab === "inboxes" ? { backgroundColor: currentTenant.primaryColor } : {}}\n                    >\n                      <Inbox size={18} />\n                      Departamentos\n                    </button>'
);

// Render view
content = content.replace(
  '<TeamManagement tenantId={currentTenant.id} />\n                )}',
  '<TeamManagement tenantId={currentTenant.id} />\n                )}\n                {adminTab === "inboxes" && (\n                  <InboxManagement tenantId={currentTenant.id} />\n                )}'
);

fs.writeFileSync('App.tsx', content);
