const fs = require('fs');
let code = fs.readFileSync('components/Cart.tsx', 'utf8');

const regex = /const CROSS_SELL_RULES = \[[\s\S]*?function getCrossSellRecommendation\(cartItems: any\[\]\) \{[\s\S]*?return null;\n\}/;

const newLogic = `const CROSS_SELL_RULES = [
  // 1. Gripes e Resfriados <-> Vitaminas e Imunidade
  {
    triggerKeywords: ["antigripal", "resfriado", "gripe", "tosse", "xarope", "descongestionante"],
    suggestedCategory: "Vitaminas e Imunidade",
    searchQuery: "vitamina",
    message: "Reforce sua imunidade: Aproveite e leve também nossa linha de Vitaminas!",
    cta: "Ver Vitaminas",
    icon: "PlusCircle",
    exclusionKeywords: ["vitamina", "imunidade", "ascorbico", "zinco"]
  },
  {
    triggerKeywords: ["vitamina", "imunidade", "ascorbico", "zinco", "suplemento", "imuno"],
    suggestedCategory: "Gripes e Resfriados",
    searchQuery: "gripe",
    message: "Prevenção é tudo: Que tal reforçar seu kit com antigripais e xaropes?",
    cta: "Ver Antigripais",
    icon: "ShieldAlert",
    exclusionKeywords: ["antigripal", "gripe", "resfriado", "xarope", "descongestionante"]
  },
  
  // 2. Linha Infantil / Bebês <-> Higiene e Acessórios
  {
    triggerKeywords: ["fralda", "infantil", "bebê", "bebe", "mamãe", "chupeta", "mamadeira"],
    suggestedCategory: "Higiene Infantil",
    searchQuery: "assadura",
    message: "Vai levar itens para o bebê? Não esqueça a pomada para assadura e os lencinhos!",
    cta: "Ver Higiene Infantil",
    icon: "Baby",
    exclusionKeywords: ["assadura", "lenço", "pomada", "toalhinha"]
  },
  {
    triggerKeywords: ["assadura", "lenço umedecido", "lenco umedecido", "pomada infantil", "toalhinha"],
    suggestedCategory: "Fraldas",
    searchQuery: "fralda",
    message: "Estoque garantido: Aproveite para levar mais fraldas para o bebê!",
    cta: "Ver Fraldas",
    icon: "Baby",
    exclusionKeywords: ["fralda", "pampers", "huggies"]
  },

  // 3. Dores e Inflamações <-> Protetores Gástricos / Relaxantes / Compressas
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
  },

  // 4. Cuidados com a Pele / Dermocosméticos <-> Protetor Solar / Hidratantes
  {
    triggerKeywords: ["sabonete facial", "limpeza de pele", "acne", "esfoliante", "skincare", "dermocosmetico"],
    suggestedCategory: "Protetor Solar",
    searchQuery: "protetor solar",
    message: "Não esqueça o básico: Complete seu skincare com um bom Protetor Solar!",
    cta: "Ver Protetores Solares",
    icon: "Sparkles",
    exclusionKeywords: ["protetor solar", "fps", "sun", "bloqueador"]
  },
  {
    triggerKeywords: ["protetor solar", "fps", "sun", "bloqueador", "hidratante corporal", "loção"],
    suggestedCategory: "Dermocosméticos",
    searchQuery: "facial",
    message: "Cuidado completo: Adicione sabonetes faciais e dermocosméticos à sua rotina.",
    cta: "Ver Dermocosméticos",
    icon: "Sparkles",
    exclusionKeywords: ["sabonete facial", "limpeza", "acne", "esfoliante", "skincare", "dermocosmetico"]
  },

  // 5. Saúde Bucal <-> Enxaguantes / Fio Dental / Clareadores
  {
    triggerKeywords: ["creme dental", "pasta de dente", "escova dental", "escova de dente"],
    suggestedCategory: "Enxaguantes e Fio Dental",
    searchQuery: "fio dental",
    message: "Higiene bucal completa: Que tal adicionar fio dental ou um enxaguante bucal?",
    cta: "Ver Saúde Bucal",
    icon: "PlusCircle",
    exclusionKeywords: ["fio dental", "enxaguante", "listerine", "cepacol", "antisséptico"]
  },
  {
    triggerKeywords: ["fio dental", "enxaguante", "listerine", "cepacol", "antisséptico bucal"],
    suggestedCategory: "Cremes e Escovas",
    searchQuery: "creme dental",
    message: "Troque sua escova: Aproveite e renove suas escovas e cremes dentais!",
    cta: "Ver Escovas",
    icon: "PlusCircle",
    exclusionKeywords: ["creme dental", "pasta", "escova"]
  },

  // 6. Aparelhos de Medição e Saúde <-> Suplementos / Vitaminas / Descartáveis
  {
    triggerKeywords: ["glicosímetro", "glicosimetro", "medidor de pressão", "aparelho de pressao", "tira reagente", "lanceta"],
    suggestedCategory: "Descartáveis e Suplementos",
    searchQuery: "suplemento",
    message: "Monitoramento em dia: Leve também suas vitaminas e materiais descartáveis.",
    cta: "Ver Suplementos",
    icon: "ShieldAlert",
    exclusionKeywords: ["vitamina", "suplemento", "algodão", "álcool", "seringa"]
  },
  
  // 7. Cabelos / Shampoos <-> Tratamentos capilares / Condicionadores
  {
    triggerKeywords: ["shampoo", "xampu", "lavagem"],
    suggestedCategory: "Tratamentos Capilares",
    searchQuery: "condicionador",
    message: "Cabelos perfeitos: Leve o condicionador ou uma máscara de tratamento capilar!",
    cta: "Ver Tratamentos",
    icon: "Sparkles",
    exclusionKeywords: ["condicionador", "máscara", "mascara", "creme de pentear", "tratamento"]
  },
  {
    triggerKeywords: ["condicionador", "máscara capilar", "mascara capilar", "creme de pentear", "reparador"],
    suggestedCategory: "Shampoos",
    searchQuery: "shampoo",
    message: "Faltou o Shampoo? Complete sua linha de cuidados para o cabelo.",
    cta: "Ver Shampoos",
    icon: "Sparkles",
    exclusionKeywords: ["shampoo", "xampu"]
  }
];

function getCrossSellRecommendation(cartItems: any[]) {
  if (!cartItems || cartItems.length === 0) return null;
  
  const normalize = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  
  const cartTexts = cartItems.map(item => normalize(item.name + " " + (item.category || "")));
  
  for (const rule of CROSS_SELL_RULES) {
    const isTriggered = rule.triggerKeywords.some(kw => cartTexts.some(text => text.includes(normalize(kw))));
    
    if (isTriggered) {
      const hasSuggested = rule.exclusionKeywords.some(kw => cartTexts.some(text => text.includes(normalize(kw))));
      if (!hasSuggested) {
         return rule;
      }
    }
  }
  
  return null;
}`;

code = code.replace(regex, newLogic);
fs.writeFileSync('components/Cart.tsx', code);
