const fs = require('fs');
let code = fs.readFileSync('components/Cart.tsx', 'utf8');

const oldRules = `  // 3. Dores e Inflamações <-> Protetores Gástricos / Relaxantes / Compressas
  {
    triggerKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"],
    suggestedCategory: "Relaxantes Musculares",
    searchQuery: "relaxante",
    message: "Alívio completo: Leve relaxantes musculares ou compressas para melhorar as dores.",
    cta: "Ver Relaxantes",
    icon: "ShieldAlert",
    exclusionKeywords: ["relaxante", "dorflex", "tandrilax", "compresa", "gel", "salompas", "mioflex"]
  },
  {
    triggerKeywords: ["relaxante", "dorflex", "tandrilax", "compresa", "gel", "salompas", "mioflex"],
    suggestedCategory: "Analgésicos",
    searchQuery: "dor",
    message: "Potencialize o alívio: Adicione um analgésico ou anti-inflamatório ao pedido.",
    cta: "Ver Analgésicos",
    icon: "ShieldAlert",
    exclusionKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"]
  },`;

const newRules = `  // 3. Dores e Inflamações <-> Protetores Gástricos
  {
    triggerKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"],
    suggestedCategory: "Estômago e Digestão",
    searchQuery: "estomago",
    message: "Evite irritações: O uso de anti-inflamatórios pode irritar o estômago. Que tal um protetor gástrico?",
    cta: "Ver Digestivos",
    icon: "ShieldAlert",
    exclusionKeywords: ["estômago", "estomago", "digestão", "azia", "omeprazol", "pantoprazol", "gastrico", "gástrico"]
  },
  {
    triggerKeywords: ["estômago", "estomago", "digestão", "azia", "omeprazol", "pantoprazol", "gastrico", "gástrico"],
    suggestedCategory: "Analgésicos e Anti-inflamatórios",
    searchQuery: "dor",
    message: "Farmacinha completa: Aproveite para abastecer seu kit com analgésicos e anti-inflamatórios.",
    cta: "Ver Analgésicos",
    icon: "ShieldAlert",
    exclusionKeywords: ["anti-inflamatório", "antiinflamatorio", "dor", "analgésico", "analgesico", "ibuprofeno", "dipirona", "paracetamol"]
  },`;

code = code.replace(oldRules, newRules);

fs.writeFileSync('components/Cart.tsx', code);
