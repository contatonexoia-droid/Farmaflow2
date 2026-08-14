const fs = require('fs');
let code = fs.readFileSync('components/AdminSettings.tsx', 'utf8');

// Add imports
if (!code.includes('import { UpsellCard }')) {
  code = code.replace(
    "import { Upload,",
    "import { UpsellCard } from './UpsellCard';\nimport { Tags, Zap, Upload,"
  );
}

// Replace the AtendimentoTab render block
const targetStr = `{activeTab === 'atendimento' && (
          <div className="animate-in fade-in duration-300">
            <AtendimentoSettings config={formData} onConfigUpdate={onConfigUpdate} />
          </div>
        )}`;

const replaceStr = `{activeTab === 'atendimento' && (
          <div className="animate-in fade-in duration-300">
            {config.isChatEnabled ? (
              <AtendimentoSettings config={formData} onConfigUpdate={onConfigUpdate} />
            ) : (
              <UpsellCard
                title="Atendimento Profissional no WhatsApp"
                description="Liberte o potencial da sua equipe com as ferramentas avançadas de chat. Crie etiquetas personalizadas para organizar conversas, respostas rápidas para agilizar o atendimento e uma mensagem automática de boas-vindas com o cardápio da sua farmácia."
                icon={MessageSquare}
                features={[
                  { title: "Mensagem de Boas-Vindas", description: "Envie automaticamente seu catálogo na primeira mensagem.", icon: Bot, iconColor: "text-purple-500" },
                  { title: "Etiquetas e Organização", description: "Classifique clientes por prioridade, financeiro ou status do pedido.", icon: Tags, iconColor: "text-blue-500" },
                  { title: "Respostas Rápidas", description: "Crie atalhos (ex: /pix, /endereco) para textos frequentes.", icon: Zap, iconColor: "text-yellow-500" }
                ]}
              />
            )}
          </div>
        )}`;

if (code.includes(targetStr)) {
  code = code.replace(targetStr, replaceStr);
  fs.writeFileSync('components/AdminSettings.tsx', code);
  console.log('Successfully patched AdminSettings.tsx');
} else {
  console.log('Target string not found. Please review the file manually.');
}
