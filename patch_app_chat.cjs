const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

// Patch mobile sidebar button
const mobileBtn = `<button
                        onClick={() => {
                          setAdminTab("chat");
                          setIsSidebarOpen(false);
                        }}
                        className={\`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "chat" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}\`}
                        style={
                          adminTab === "chat"
                            ? { backgroundColor: currentTenant.primaryColor }
                            : {}
                        }
                      >
                        <MessageSquare size={20} />
                        Chat & WhatsApp
                      </button>`;

if (content.includes(mobileBtn)) {
  content = content.replace(mobileBtn, `{currentTenant?.isChatEnabled && (\n                      ${mobileBtn}\n                      )}`);
} else {
  console.log("Could not find mobile chat button to patch.");
}

// Patch desktop sidebar button
const desktopBtn = `<button
                      onClick={() => setAdminTab("chat")}
                      className={\`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "chat" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}\`}
                      style={
                        adminTab === "chat"
                          ? { backgroundColor: currentTenant.primaryColor }
                          : {}
                      }
                    >
                      <MessageSquare size={18} />
                      Chat & WhatsApp
                    </button>`;

if (content.includes(desktopBtn)) {
  content = content.replace(desktopBtn, `{currentTenant?.isChatEnabled && (\n                    ${desktopBtn}\n                    )}`);
} else {
  console.log("Could not find desktop chat button to patch.");
}

fs.writeFileSync('App.tsx', content);
