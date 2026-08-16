const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

const mobileBtnRegex = /<button\s+onClick=\{\(\) => \{\s+setAdminTab\("chat"\);\s+setIsSidebarOpen\(false\);\s+\}\}\s+className=\{`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-\[15px\] mb-2 \$\{adminTab === "chat" \? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"\}`\}\s+style=\{\s+adminTab === "chat"\s+\? \{ backgroundColor: currentTenant.primaryColor \}\s+: \{\}\s+\}\s+>\s+<MessageSquare size=\{20\} \/>\s+Central de Chat\s+<\/button>/g;

content = content.replace(mobileBtnRegex, match => `{currentTenant?.isChatEnabled && (\n${match}\n)}`);

const desktopBtnRegex = /<button\s+onClick=\{\(\) => setAdminTab\("chat"\)\}\s+className=\{`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-\[15px\] mb-2 \$\{adminTab === "chat" \? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"\}`\}\s+style=\{\s+adminTab === "chat"\s+\? \{ backgroundColor: currentTenant.primaryColor \}\s+: \{\}\s+\}\s+>\s+<MessageSquare size=\{18\} \/>\s+Central de Chat\s+<\/button>/g;

content = content.replace(desktopBtnRegex, match => `{currentTenant?.isChatEnabled && (\n${match}\n)}`);

fs.writeFileSync('App.tsx', content);
