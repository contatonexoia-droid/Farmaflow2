const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

const regex1 = /<button\s+onClick=\{\(\) => \{\s+setAdminTab\("inboxes"\);\s+setIsSidebarOpen\(false\);\s+\}\}[\s\S]*?<\/button>/g;
content = content.replace(regex1, match => `{currentTenant?.isChatEnabled && (\n${match}\n)}`);

const regex2 = /<button\s+onClick=\{\(\) => setAdminTab\("inboxes"\)\}[\s\S]*?<\/button>/g;
content = content.replace(regex2, match => `{currentTenant?.isChatEnabled && (\n${match}\n)}`);

fs.writeFileSync('App.tsx', content);
