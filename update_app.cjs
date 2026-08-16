const fs = require('fs');
let app = fs.readFileSync('App.tsx', 'utf8');

app = app.replace(
`import {
  X,
  Plus,`,
`import { UpsellCard } from "./components/UpsellCard";
import { MessageSquareShare, Users, Zap } from "lucide-react";

import {
  X,
  Plus,`);

// Remove isChatEnabled wrapper for Chat tab (sidebar 1)
app = app.replace(
`                      {currentTenant?.isChatEnabled && (
                      <button
                        onClick={() => {
                          setAdminTab("chat");
                          setIsSidebarOpen(false);
                        }}
                        className={\`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "chat" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}\`}
                      >
                        <MessageSquare size={20} />
                        Central de Chat
                      </button>
                      )}`,
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

// Remove isChatEnabled wrapper for Inboxes tab (sidebar 1)
app = app.replace(
`                      {currentTenant?.isChatEnabled && (
                      <button
                        onClick={() => {
                          setAdminTab("inboxes");
                          setIsSidebarOpen(false);
                        }}
                        className={\`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "inboxes" ? "bg-brand text-brand-contrast" : "text-gray-500 hover:bg-gray-50"}\`}
                      >
                        <Inbox size={20} />
                        Departamentos
                      </button>
                      )}`,
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

// Remove isChatEnabled wrapper for Inboxes tab (sidebar 2)
app = app.replace(
`                    {currentTenant?.isChatEnabled && (
                    <button
                      onClick={() => setAdminTab("inboxes")}
                      className={\`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "inboxes" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}\`}
                      style={adminTab === "inboxes" ? { backgroundColor: currentTenant.primaryColor } : {}}
                    >
                      <Inbox size={18} />
                      Departamentos
                    </button>
                    )}`,
`                    <button
                      onClick={() => setAdminTab("inboxes")}
                      className={\`flex items-center gap-3 px-4 py-4 rounded-2xl font-bold text-[15px] mb-2 \${adminTab === "inboxes" ? "bg-brand text-brand-contrast shadow-md" : "text-gray-500 hover:bg-gray-100"}\`}
                      style={adminTab === "inboxes" ? { backgroundColor: currentTenant.primaryColor } : {}}
                    >
                      <Inbox size={18} />
                      Departamentos
                      {!currentTenant?.isChatEnabled && <Lock size={14} className="ml-auto opacity-50" />}
                    </button>`);

// Remove isChatEnabled wrapper for Chat tab (sidebar 2)
app = app.replace(
`                    {currentTenant?.isChatEnabled && (
                    <button
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
                    </button>
                    )}`,
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

// Update content rendering for inboxes
app = app.replace(
`                {adminTab === "inboxes" && currentTenant?.isChatEnabled && (
                  <React.Suspense fallback={<div className="flex h-full items-center justify-center p-8"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /></div>}>
                    <InboxManagement tenantId={currentTenant.id} />
                  </React.Suspense>
                )}`,
`                {adminTab === "inboxes" && (
                  currentTenant?.isChatEnabled ? (
                    <React.Suspense fallback={<div className="flex h-full items-center justify-center p-8"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /></div>}>
                      <InboxManagement tenantId={currentTenant.id} />
                    </React.Suspense>
                  ) : (
                    <UpsellCard
                      title="Departamentos e Filas de Atendimento"
                      description="Organize o fluxo de mensagens do WhatsApp dividindo o atendimento em setores (ex: Delivery, Farmacêutico, Dúvidas). Atribua conversas automaticamente para as equipes corretas."
                      icon={Inbox}
                      features={[
                        { title: "Filas de Espera", description: "Visualize quantos clientes estão aguardando atendimento em cada setor.", icon: Users, iconColor: "text-blue-400" },
                        { title: "Transferências Inteligentes", description: "Transfira conversas entre departamentos com um clique.", icon: MessageSquareShare, iconColor: "text-emerald-400" }
                      ]}
                    />
                  )
                )}`);

// Update content rendering for chat
app = app.replace(
`                {adminTab === "chat" && currentTenant?.isChatEnabled && <ChatCentral currentUser={session?.user} userRole={session?.role} tenantId={currentTenant?.id} />}`,
`                {adminTab === "chat" && (
                  currentTenant?.isChatEnabled ? (
                    <ChatCentral currentUser={session?.user} userRole={session?.role} tenantId={currentTenant?.id} />
                  ) : (
                    <UpsellCard
                      title="Central de Chat Multi-Atendentes"
                      description="Centralize todo o atendimento do WhatsApp da sua farmácia em uma única tela. Vários operadores podem atender simultaneamente usando o mesmo número."
                      icon={MessageSquare}
                      features={[
                        { title: "Múltiplos Atendentes", description: "Toda sua equipe atendendo junto no mesmo número de WhatsApp.", icon: Users, iconColor: "text-emerald-400" },
                        { title: "Agilidade Total", description: "Envie links de produtos, controle pedidos e histórico na mesma tela.", icon: Zap, iconColor: "text-yellow-400" }
                      ]}
                    />
                  )
                )}`);

fs.writeFileSync('App.tsx', app);
console.log('App updated');
