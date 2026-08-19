// Utility for Pharmaceutical Patient Context & Continuous Use Forecasting

export interface ItemForecast {
  isContinuousUse: boolean;
  durationDays: number;
  endDate: Date;
  endDateFormatted: string;
  daysRemaining: number;
  statusText: string;
  urgency: 'OVERDUE' | 'URGENT' | 'UPCOMING' | 'OK';
  suggestedMessage: string;
}

// Lista curada de termos e princípios ativos comumente caracterizados como Uso Contínuo
const CONTINUOUS_USE_KEYWORDS = [
  // Anti-hipertensivos e Cardiovasculares
  'losartana', 'enalapril', 'captopril', 'hidroclorotiazida', 'atenolol', 'amlodipino',
  'anlodipino', 'valsartana', 'candesartana', 'olmesartana', 'ramipril', 'espironolactona',
  'indapamida', 'carvedilol', 'propranolol', 'metoprolol', 'nebivolol', 'bisoprolol',
  'diltiazem', 'verapamil', 'metildopa', 'nifedipino',

  // Antidiabéticos
  'metformina', 'gliclazida', 'glimepirida', 'glibenclamida', 'insulina', 'dapagliflozina',
  'empagliflozina', 'vildagliptina', 'sitagliptina', 'linagliptina', 'forxiga', 'jardiance',
  'januvia', 'trayenta', 'galvus', 'glifage', 'victoza', 'ozempic', 'rybelsus',

  // Colesterol e Lipídios
  'sinvastatina', 'atorvastatina', 'rosuvastatina', 'ciprofibrato', 'fenofibrato',
  'ezetimiba', 'pitavastatina', 'pravastatina', 'lipitor', 'crestor',

  // Tireoide
  'levotiroxina', 'puran', 'puran t4', 'euthyrox', 'levoid', 'synthroid', 'tapazol', 'propiltiouracila',

  // Anticoncepcionais
  'ciclo 21', 'selene', 'yasmin', 'yaz', 'microvlar', 'diane 35', 'elani', 'tamisa',
  'adoless', 'qlaira', 'cerazette', 'nactali', 'desogestrel', 'drospirenona', 'etinilestradiol',
  'levonorgestrel', 'gestodeno', 'dienogeste', 'depo-provera',

  // Psiquiatria / SNC / Antidepressivos / Ansiolíticos / Anticonvulsivantes
  'sertralina', 'escitalopram', 'fluoxetina', 'venlafaxina', 'desvenlafaxina', 'citalopram',
  'paroxetina', 'clonazepam', 'alprazolam', 'diazepam', 'lorazepam', 'bromazepam',
  'zolpidem', 'quetiapina', 'risperidona', 'olanzapina', 'aripiprazol', 'duloxetina',
  'amitriptilina', 'nortriptilina', 'bupropiona', 'pregabalina', 'gabapentina',
  'lamotrigina', 'topiramato', 'carbamazepina', 'oxcarbazepina', 'valproato', 'depakene',
  'depakote', 'rivotril', 'lexotan', 'frontal', 'reconter', 'exodus', 'assert', 'daforin',
  'pondera', 'litio', 'carbonato de litio', 'carbolitium',

  // Anticoagulantes e Antiagregantes
  'varfarina', 'marevan', 'coumadin', 'xarelto', 'eliquis', 'pradaxa', 'rivaroxabana',
  'apixabana', 'dabigatrana', 'clopidogrel', 'plavix', 'aas protect', 'somalgin',

  // Próstata e Urologia
  'tansulosina', 'finasterida', 'dutasterida', 'combodart', 'secotex',

  // Glaucoma / Colírios contínuos
  'travoprosta', 'latanoprosta', 'bimatoprosta', 'timolol', 'brimonidina', 'xalatan', 'travatan',

  // Gota / Hiperuricemia
  'alopurinol', 'zyloric',

  // Osteoporose e Cálcio
  'alendronato', 'risedronato', 'ibandronato', 'carbonato de calcio', 'calcio d3',

  // Protetores Gástricos Contínuos
  'omeprazol', 'pantoprazol', 'esomeprazol', 'lansoprazol', 'rabeprazol', 'dexlansoprazol'
];

/**
 * Normaliza texto removendo acentos e convertendo para minúsculas
 */
function normalizeText(text?: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Verifica se um produto/item é caracterizado como Uso Contínuo
 */
export function isProductContinuousUse(item: any): boolean {
  if (!item) return false;

  // 1. Flag explícita no produto/item
  if (item.is_continuous_use === true || item.iscontinuoususe === true || item.is_continuous_use === 1 || item.is_continuous_use === 'true') {
    return true;
  }

  // 2. Categoria explícita
  const category = normalizeText(item.category);
  if (category.includes('uso continuo') || category.includes('continuo') || category.includes('cronico') || category.includes('hipertensao') || category.includes('diabetes')) {
    return true;
  }

  // 3. Verificação por Nome, Princípio Ativo, Descrição e Apresentação
  const searchStr = `${normalizeText(item.name || item.product_name)} ${normalizeText(item.active_principle || item.activePrinciple)} ${normalizeText(item.presentation)} ${normalizeText(item.indications)}`;

  return CONTINUOUS_USE_KEYWORDS.some(kw => searchStr.includes(kw));
}

/**
 * Extrai a quantidade de comprimidos/dias de duração estimada da apresentação ou do cadastro
 */
export function calculateItemEstimatedDays(item: any): number {
  if (!item) return 30;

  const itemQty = Math.max(1, Number(item.quantity) || 1);

  // Se o item já tiver a duração cadastrada
  if (item.continuous_use_days && Number(item.continuous_use_days) > 0) {
    return Number(item.continuous_use_days) * itemQty;
  }

  const textToScan = `${item.presentation || ''} ${item.name || item.product_name || ''}`;
  
  // Procura por padrões como: "30 comprimidos", "60 cápsulas", "28 drágeas", "cx 30 comp", "c/ 30 cp", "56 comp"
  const match = textToScan.match(/\b(?:c\/|com|cx\s+com|cx\s+c\/|cx)?\s*(\d{1,3})\s*(?:comprimidos|comprimido|comp|cp|capsulas|cápsulas|caps|drageas|drágeas|drg|sachês|saches|envelopes|doses)\b/i);
  
  if (match && match[1]) {
    const units = parseInt(match[1], 10);
    // Se for entre 5 e 120 unidades, assumimos posologia padrão de 1 unidade ao dia
    if (units >= 5 && units <= 120) {
      return units * itemQty;
    }
  }

  // Padrão de anticoncepcionais comuns (cartela de 21, 24 ou 28 dias)
  if (normalizeText(textToScan).includes('cartela') || normalizeText(textToScan).includes('anticoncepcional')) {
    return 28 * itemQty;
  }

  // Duração padrão para uso contínuo (1 mês por unidade)
  return 30 * itemQty;
}

/**
 * Calcula a previsão exata de término e gera o status formatado
 */
export function calculateItemDepletionForecast(orderDateStr: string | undefined, item: any): ItemForecast {
  const isContinuous = isProductContinuousUse(item);
  const durationDays = calculateItemEstimatedDays(item);

  // Data base do pedido (com fallback para hoje)
  let orderDate = new Date();
  if (orderDateStr) {
    const parsed = new Date(orderDateStr);
    if (!isNaN(parsed.getTime())) {
      orderDate = parsed;
    }
  }

  // Data de término = data do pedido + (duração * 24h)
  const endDateMs = orderDate.getTime() + (durationDays * 24 * 60 * 60 * 1000);
  const endDate = new Date(endDateMs);

  // Data atual
  const now = new Date();
  const diffMs = endDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const day = String(endDate.getDate()).padStart(2, '0');
  const month = String(endDate.getMonth() + 1).padStart(2, '0');
  const year = endDate.getFullYear();
  const endDateFormatted = `${day}/${month}`;

  let statusText = '';
  let urgency: ItemForecast['urgency'] = 'OK';

  if (daysRemaining < 0) {
    const daysAgo = Math.abs(daysRemaining);
    statusText = daysAgo === 1 ? 'Terminou ontem (Reposição urgente)' : `Terminou há ${daysAgo} dias (Hora de repor!)`;
    urgency = 'OVERDUE';
  } else if (daysRemaining === 0) {
    statusText = 'Acaba hoje! (Oferecer reposição)';
    urgency = 'OVERDUE';
  } else if (daysRemaining <= 3) {
    statusText = `Falta aprox. ${daysRemaining} ${daysRemaining === 1 ? 'dia' : 'dias'} para acabar (Reposição imediata)`;
    urgency = 'URGENT';
  } else if (daysRemaining <= 7) {
    statusText = `Falta aprox. ${daysRemaining} dias para acabar (Ciclo de renovação)`;
    urgency = 'UPCOMING';
  } else {
    statusText = `Previsão de término: ${endDateFormatted} (em ${daysRemaining} dias)`;
    urgency = 'OK';
  }

  const prodName = item.name || item.product_name || 'seu medicamento de uso contínuo';
  const suggestedMessage = `Olá! Notamos que seu tratamento com *${prodName}* está previsto para terminar em breve (${endDateFormatted}). Gostaria de garantir a reposição com entrega para hoje?`;

  return {
    isContinuousUse: isContinuous,
    durationDays,
    endDate,
    endDateFormatted: `${endDateFormatted}/${year}`,
    daysRemaining,
    statusText,
    urgency,
    suggestedMessage
  };
}
