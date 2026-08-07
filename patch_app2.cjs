const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

// Render view
content = content.replace(
  /<TeamManagement tenantId=\{currentTenant\.id\} \/>\n\s*<\/React\.Suspense>\n\s*\)}/, // this was the original regex
  // Let's just replace based on the actual lines
  '<TeamManagement tenantId={currentTenant.id} />\n                )}\n                {adminTab === "inboxes" && (\n                  <React.Suspense fallback={<div className="flex h-full items-center justify-center p-8"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /></div>}>\n                    <InboxManagement tenantId={currentTenant.id} />\n                  </React.Suspense>\n                )}'
);

content = content.replace(
  /<TeamManagement tenantId=\{currentTenant\.id\} \/>\n\s*\)}/,
  '<TeamManagement tenantId={currentTenant.id} />\n                )}\n                {adminTab === "inboxes" && (\n                  <React.Suspense fallback={<div className="flex h-full items-center justify-center p-8"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /></div>}>\n                    <InboxManagement tenantId={currentTenant.id} />\n                  </React.Suspense>\n                )}'
);


fs.writeFileSync('App.tsx', content);
