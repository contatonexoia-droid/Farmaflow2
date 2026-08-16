const fs = require('fs');
let app = fs.readFileSync('App.tsx', 'utf8');

// The indentation might be different, let's use regex
app = app.replace(/\{\s*currentTenant\?\.isChatEnabled\s*&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*\{\s*setAdminTab\("inboxes"\);\s*setIsSidebarOpen\(false\);\s*\}\}[\s\S]*?<Inbox size=\{20\}\s*\/>\s*Departamentos\s*<\/button>\s*\)/g, 
`                      <button
                        onClick={() => {
                          setAdminTab("inboxes");
                          setIsSidebarOpen(false);
                        }}
                        className={\`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "inboxes" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}\`}
                      >
                        <Inbox size={20} />
                        Departamentos
                        {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                      </button>`);

app = app.replace(/\{\s*currentTenant\?\.isChatEnabled\s*&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*\{\s*setAdminTab\("chat"\);\s*setIsSidebarOpen\(false\);\s*\}\}[\s\S]*?<MessageSquare size=\{20\}\s*\/>\s*Central de Chat\s*<\/button>\s*\)/g,
`                      <button
                        onClick={() => {
                          setAdminTab("chat");
                          setIsSidebarOpen(false);
                        }}
                        className={\`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "chat" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}\`}
                      >
                        <MessageSquare size={20} />
                        Central de Chat
                        {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                      </button>`);

app = app.replace(/\{\s*currentTenant\?\.isChatEnabled\s*&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*setAdminTab\("inboxes"\)\}[\s\S]*?<Inbox size=\{18\}\s*\/>\s*Departamentos\s*<\/button>\s*\)/g,
`                    <button
                      onClick={() => setAdminTab("inboxes")}
                      className={\`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "inboxes" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}\`}
                      style={adminTab === "inboxes" ? { backgroundColor: currentTenant.primaryColor } : {}}
                    >
                      <Inbox size={18} />
                      Departamentos
                      {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                    </button>`);

app = app.replace(/\{\s*currentTenant\?\.isChatEnabled\s*&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*setAdminTab\("chat"\)\}[\s\S]*?<MessageSquare size=\{18\}\s*\/>\s*Central de Chat\s*<\/button>\s*\)/g,
`                    <button
                      onClick={() => setAdminTab("chat")}
                      className={\`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "chat" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}\`}
                      style={
                        adminTab === "chat"
                          ? { backgroundColor: currentTenant.primaryColor }
                          : {}
                      }
                    >
                      <MessageSquare size={18} />
                      Central de Chat
                      {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                    </button>`);

// Fix missing Lock import if it's missing
if (!app.includes('Lock,')) {
    app = app.replace('import { UpsellCard } from "./components/UpsellCard";', 'import { UpsellCard } from "./components/UpsellCard";\nimport { Lock } from "lucide-react";');
}

fs.writeFileSync('App.tsx', app);
console.log('Regex replace done');
