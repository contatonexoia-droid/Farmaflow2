import { DepartmentConfig } from '../types';

export const OFFICIAL_DEPARTMENTS = [
  "Medicamentos",
  "Saúde e Bem-Estar",
  "Dermocosméticos e Beleza",
  "Higiene e Cuidados Pessoais",
  "Mamãe e Bebê",
  "Saúde, Ortopedia e Primeiros Socorros",
  "Conveniência"
] as const;

export type OfficialDepartment = typeof OFFICIAL_DEPARTMENTS[number];

export const OFFICIAL_TAXONOMY: Record<OfficialDepartment, string[]> = {
  "Medicamentos": [
    "Dor e Febre",
    "Gripe e Resfriado",
    "Alergias",
    "Saúde Digestiva",
    "Saúde Respiratória",
    "Diabetes",
    "Pressão e Coração",
    "Saúde da Mulher",
    "Saúde do Homem",
    "Outros Medicamentos"
  ],
  "Saúde e Bem-Estar": [
    "Vitaminas e Minerais",
    "Suplementos",
    "Imunidade",
    "Saúde Digestiva",
    "Energia e Disposição",
    "Sono e Relaxamento",
    "Controle de Peso",
    "Esporte e Performance",
    "Saúde da Mulher",
    "Saúde do Homem"
  ],
  "Dermocosméticos e Beleza": [
    "Cuidados com o Rosto",
    "Cuidados com o Corpo",
    "Proteção Solar",
    "Cabelos",
    "Maquiagem",
    "Perfumes",
    "Cuidados com as Unhas",
    "Beleza Masculina"
  ],
  "Higiene e Cuidados Pessoais": [
    "Higiene Bucal",
    "Banho e Corpo",
    "Desodorantes",
    "Higiene Íntima",
    "Cuidados Masculinos",
    "Absorventes e Cuidados Femininos",
    "Lenços e Algodão"
  ],
  "Mamãe e Bebê": [
    "Fraldas",
    "Higiene do Bebê",
    "Alimentação Infantil",
    "Amamentação",
    "Cuidados com a Mamãe"
  ],
  "Saúde, Ortopedia e Primeiros Socorros": [
    "Primeiros Socorros",
    "Aparelhos de Saúde",
    "Ortopédicos",
    "Cuidados para Idosos",
    "Outros Acessórios de Saúde"
  ],
  "Conveniência": [
    "Alimentos e Bebidas",
    "Snacks",
    "Produtos para o Dia a Dia",
    "Acessórios",
    "Utilidades"
  ]
};

export const DEFAULT_DEPARTMENT_ICONS: Record<OfficialDepartment, string> = {
  "Medicamentos": "Pill",
  "Saúde e Bem-Estar": "Heart",
  "Dermocosméticos e Beleza": "Sparkles",
  "Higiene e Cuidados Pessoais": "Droplets",
  "Mamãe e Bebê": "Baby",
  "Saúde, Ortopedia e Primeiros Socorros": "BriefcaseMedical",
  "Conveniência": "ShoppingBasket"
};

export const FALLBACK_DEPARTMENT: OfficialDepartment = "Medicamentos";
export const FALLBACK_SUBCATEGORY = "Outros Medicamentos";
export const DEPARTMENT_MAPPING = OFFICIAL_TAXONOMY;

// Helper de normalização de texto sem acentos e em minúsculas
export const normalizeTaxonomyText = (str: string): string => {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Obter subcategorias oficiais de um departamento
export const getOfficialSubcategories = (deptName?: string): string[] => {
  if (!deptName) return [];
  const matchedDept = OFFICIAL_DEPARTMENTS.find(
    d => normalizeTaxonomyText(d) === normalizeTaxonomyText(deptName)
  );
  if (matchedDept && OFFICIAL_TAXONOMY[matchedDept]) {
    return OFFICIAL_TAXONOMY[matchedDept];
  }
  return [];
};

// Obter departamento para uma subcategoria ou texto de categoria
export const getDepartmentForCategory = (
  category: string,
  _customDepartments?: DepartmentConfig[]
): OfficialDepartment => {
  if (!category) return FALLBACK_DEPARTMENT;
  const norm = normalizeTaxonomyText(category);

  // Se já for o nome de um departamento oficial
  for (const dept of OFFICIAL_DEPARTMENTS) {
    if (normalizeTaxonomyText(dept) === norm) {
      return dept;
    }
  }

  // Se corresponder exatamente a uma subcategoria oficial de um departamento
  for (const [dept, subcats] of Object.entries(OFFICIAL_TAXONOMY)) {
    for (const subcat of subcats) {
      if (normalizeTaxonomyText(subcat) === norm) {
        return dept as OfficialDepartment;
      }
    }
  }

  // Caso seja categoria herdada ou bruta, roda o classificador padrão
  const classified = classifyProductTaxonomy({ rawCategory: category, name: category });
  return classified.department;
};

export interface ProductClassificationInput {
  name?: string;
  activePrinciple?: string;
  description?: string;
  rawCategory?: string;
  drugType?: string;
  indications?: string;
  manufacturer?: string;
}

export interface ProductClassificationResult {
  department: OfficialDepartment;
  subcategory: string;
}

/**
 * Motor Inteligente e Determinístico de Classificação Taxonômica FarmaFlow
 * Enquadra qualquer produto farmacêutico / varejo estritamente em 1 dos 8 Departamentos
 * e em 1 Subcategoria Oficial. Ignora termos genéricos de ERP ("OUTROS", "DIVERSOS", etc.)
 */
export const classifyProductTaxonomy = (
  input: ProductClassificationInput
): ProductClassificationResult => {
  const nameNorm = normalizeTaxonomyText(input.name || "");
  const activeNorm = normalizeTaxonomyText(input.activePrinciple || "");
  const descNorm = normalizeTaxonomyText(input.description || "");
  const rawCatNorm = normalizeTaxonomyText(input.rawCategory || "");
  const indNorm = normalizeTaxonomyText(input.indications || "");
  const drugTypeNorm = normalizeTaxonomyText(input.drugType || "");

  const fullText = `${nameNorm} ${activeNorm} ${descNorm} ${rawCatNorm} ${indNorm}`.trim();

  // Helper para testar presença de termos
  const has = (terms: string | string[], text = fullText): boolean => {
    const list = Array.isArray(terms) ? terms : [terms];
    return list.some(term => {
      const nTerm = normalizeTaxonomyText(term);
      if (!nTerm) return false;
      const regex = new RegExp(`(^|\\s)${nTerm}(\\s|$)`, "i");
      return regex.test(text) || text.includes(nTerm);
    });
  };

  // 1. PRODUTOS VETERINÁRIOS / PET (Reclassificados para Conveniência ou Medicamentos)
  if (
    has(["pet", "veterinario", "veterinaria", "cao", "caes", "cachorro", "gato", "felino", "bravecto", "nexgard", "simparic", "antipulgas", "carrapaticida", "vermifugo pet", "racao", "petisco cao", "tapete higienico pet", "shampoo pet", "areia higienica", "coleira"]) &&
    !has(["hidratante corporal", "shampoo anticaspa", "cha"])
  ) {
    // Medicamentos e tratamentos veterinários -> Medicamentos / Outros Medicamentos
    if (has(["antipulgas", "carrapaticida", "vermifugo", "pomada pet", "colirio pet", "otologico pet", "suplemento pet", "vacina pet", "sarna", "bravecto", "nexgard", "simparic", "medicamento", "remedio"])) {
      return { department: "Medicamentos", subcategory: "Outros Medicamentos" };
    }
    // Acessórios e Utilidades Pet -> Conveniência / Utilidades
    if (has(["coleira", "brinquedo", "guia", "comedouro", "bebedouro", "casinha", "arranhador", "cama pet"])) {
      return { department: "Conveniência", subcategory: "Utilidades" };
    }
    // Higiene, Rações e Alimentos Pet -> Conveniência / Produtos para o Dia a Dia
    return { department: "Conveniência", subcategory: "Produtos para o Dia a Dia" };
  }

  // 2. MAMÃE E BEBÊ
  if (
    has([
      "fralda infantil", "fralda bebe", "pampers", "huggies", "babysec", "cremer", "mamadeira", "chupeta", 
      "mordedor", "bico silicone", "leite infantil", "formula infantil", "aptamil", "nan", "enfamil", "nestogeno", 
      "mucilon", "lenco umedecido", "lenço umedecido", "toalha umedecida", "bepantol baby", "hipoglos", "desitin", 
      "mustela bebe", "johnson baby", "shampoo bebe", "sabonete bebe", "colonia bebe", "amamentacao", 
      "absorvente seios", "concha amamentacao", "bomba tira leite", "antiestrias gestante", "materna"
    ]) ||
    (has(["fralda"]) && !has(["geriatrica", "adulto", "plenitud", "bigfral", "roupa intima"]))
  ) {
    if (has(["fralda", "pants infantil", "fraldas"])) {
      return { department: "Mamãe e Bebê", subcategory: "Fraldas" };
    }
    if (has(["amamentacao", "absorvente seios", "concha amamentacao", "bomba tira leite", "pomada mamilo", "lansinoh"])) {
      return { department: "Mamãe e Bebê", subcategory: "Amamentação" };
    }
    if (has(["aptamil", "nan", "enfamil", "nestogeno", "mucilon", "papinha", "leite infantil", "formula infantil", "composto lacteo infantil"])) {
      return { department: "Mamãe e Bebê", subcategory: "Alimentação Infantil" };
    }
    if (has(["antiestrias", "gestante", "materna", "gravidez cuidados", "cuidados mamae"])) {
      return { department: "Mamãe e Bebê", subcategory: "Cuidados com a Mamãe" };
    }
    return { department: "Mamãe e Bebê", subcategory: "Higiene do Bebê" };
  }

  // 3. DERMOCOSMÉTICOS E BELEZA
  if (
    has([
      "protetor solar", "bloqueador solar", "fps", "anthelios", "minesol", "sundown", "vichy", "isdin", "laroche", 
      "agua micelar", "hidratante facial", "antirrugas", "anti-idade", "acido hialuronico", "vitamina c facial", 
      "retinol", "shampoo", "condicionador", "mascara capilar", "tintura", "coloracao", "esmalte", "acetona", 
      "maquiagem", "base facial", "batom", "rímel", "rimel", "corretivo", "perfume", "eau de parfum", "colonia", 
      "hidratante corporal", "creme corporal", "oleo corporal", "depilatorio", "veet", "cera depilatoria", "barba", 
      "espuma de barbear", "locao pos barba", "skincare", "dermocosmetico", "cosmetico"
    ]) &&
    !has(["dipirona", "antibiotico", "anti-inflamatorio", "pressao", "diabetes"])
  ) {
    if (has(["protetor solar", "bloqueador solar", "fps", "anthelios", "minesol", "sundown", "pos sol", "bronzeador", "gel pos sol"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Proteção Solar" };
    }
    if (has(["shampoo", "condicionador", "mascara capilar", "tintura", "coloracao", "cabelo", "cabelos", "leave in", "ampola capilar", "oleo capilar", "reparador pontas", "tonico capilar"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Cabelos" };
    }
    if (has(["rosto", "facial", "antirrugas", "anti idade", "anti-idade", "acido hialuronico", "vitamina c facial", "retinol", "agua micelar", "sabonete facial", "gel de limpeza facial", "serum facial", "olhos creme"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Cuidados com o Rosto" };
    }
    if (has(["maquiagem", "base", "batom", "rimel", "sombra", "delineador", "po compacto", "blush", "gloss", "corretivo facial"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Maquiagem" };
    }
    if (has(["perfume", "eau de parfum", "eau de toilette", "desodorante colonia", "colonia feminina", "colonia masculina", "fragrancia"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Perfumes" };
    }
    if (has(["esmalte", "acetona", "removedor esmalte", "alicate unha", "lixa unha", "cuticula", "unhas", "base unhas"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Cuidados com as Unhas" };
    }
    if (has(["barba", "espuma barbear", "locao pos barba", "pos barba", "oleo barba", "shampoo barba", "bozzano"])) {
      return { department: "Dermocosméticos e Beleza", subcategory: "Beleza Masculina" };
    }
    return { department: "Dermocosméticos e Beleza", subcategory: "Cuidados com o Corpo" };
  }

  // 4. HIGIENE E CUIDADOS PESSOAIS
  if (
    has([
      "creme dental", "pasta de dente", "escova dental", "escova de dente", "fio dental", "enxaguante bucal", 
      "listerine", "colgate", "oral b", "oral-b", "sensodyne", "corega", "desodorante", "antitranspirante", 
      "rexona", "dove", "nivea", "roll on", "aerosol desodorante", "sabonete", "sabonete liquido", "gel de banho", 
      "absorvente", "sempre livre", "intimus", "kotex", "protetor diario", "absorvente interno", "tampao", 
      "sabonete intimo", "dermacyd", "lucretin", "hastes flexiveis", "cotonete", "algodao", "lenco de papel", 
      "papel higienico", "lamina de barbear", "prestobarba", "mach3", "aparelho de barbear"
    ])
  ) {
    if (has(["creme dental", "pasta de dente", "escova dental", "escova dente", "fio dental", "enxaguante bucal", "listerine", "colgate", "oral b", "sensodyne", "corega", "dentadura", "afta spray", "bucal"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Higiene Bucal" };
    }
    if (has(["desodorante", "antitranspirante", "roll on", "aerosol", "body spray"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Desodorantes" };
    }
    if (has(["sabonete intimo", "intima", "dermacyd", "lucretin", "higiene intima"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Higiene Íntima" };
    }
    if (has(["absorvente", "sempre livre", "intimus", "kotex", "protetor diario", "coletor menstrual", "absorventes"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Absorventes e Cuidados Femininos" };
    }
    if (has(["prestobarba", "mach3", "lamina barbear", "aparelho barbear", "gillette"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Cuidados Masculinos" };
    }
    if (has(["algodao", "cotonete", "hastes flexiveis", "lenco papel", "lencos"])) {
      return { department: "Higiene e Cuidados Pessoais", subcategory: "Lenços e Algodão" };
    }
    return { department: "Higiene e Cuidados Pessoais", subcategory: "Banho e Corpo" };
  }

  // 5. SAÚDE, ORTOPEDIA E PRIMEIROS SOCORROS
  if (
    has([
      "curativo", "band aid", "band-aid", "esparadrapo", "gaze", "atadura", "antisseptico", "merthiolate", 
      "timerosal", "alcool 70", "povidine", "clorexidina", "agua oxigenada", "aparelho de pressao", 
      "esfigmomanometro", "termometro", "nebulizador", "inalador", "oximetro", "glicosimetro", "tiras reagentes", 
      "lancetas", "joelheira", "tornozeleira", "munhequeira", "tipoia", "cinta lombar", "colar cervical", 
      "bengala", "muleta", "cadeira de rodas", "fralda geriatrica", "plenitud", "bigfral", "roupa intima descartavel", 
      "preservativo", "camisinha", "jontex", "prudence", "blowtex", "lubrificante intimo", "teste de gravidez", 
      "clearblue", "seringa", "agulha", "coletor"
    ])
  ) {
    if (has(["curativo", "band aid", "esparadrapo", "gaze", "atadura", "antisseptico", "merthiolate", "alcool 70", "agua oxigenada", "primeiros socorros"])) {
      return { department: "Saúde, Ortopedia e Primeiros Socorros", subcategory: "Primeiros Socorros" };
    }
    if (has(["aparelho de pressao", "termometro", "nebulizador", "inalador", "oximetro", "glicosimetro", "tiras reagentes", "lanceta", "balanca"])) {
      return { department: "Saúde, Ortopedia e Primeiros Socorros", subcategory: "Aparelhos de Saúde" };
    }
    if (has(["joelheira", "tornozeleira", "munhequeira", "tipoia", "cinta lombar", "colar cervical", "bengala", "muleta", "palmilha ortopedica", "ortopedico"])) {
      return { department: "Saúde, Ortopedia e Primeiros Socorros", subcategory: "Ortopédicos" };
    }
    if (has(["fralda geriatrica", "geriatrica", "plenitud", "bigfral", "roupa intima descartavel", "incontinencia", "lenco adulto"])) {
      return { department: "Saúde, Ortopedia e Primeiros Socorros", subcategory: "Cuidados para Idosos" };
    }
    return { department: "Saúde, Ortopedia e Primeiros Socorros", subcategory: "Outros Acessórios de Saúde" };
  }

  // 6. CONVENIÊNCIA
  if (
    has([
      "snack", "salgadinho", "batata frita", "doritos", "ruffles", "castanha", "amendoim", "bala", "chiclete", 
      "trident", "halls", "drops", "chocolate", "bombom", "bis", "kitkat", "refrigerante", "coca cola", "suco", 
      "energetico", "red bull", "monster", "agua mineral", "pilha", "bateria", "carregador", "guarda chuva", 
      "isqueiro", "adocante", "barra de cereal"
    ]) &&
    !has(["vitamina", "suplemento", "dipirona", "medicamento"])
  ) {
    if (has(["snack", "salgadinho", "batata", "doritos", "ruffles", "castanha", "amendoim", "barra de cereal", "chocolate", "bombom", "bis", "kitkat", "bala", "chiclete", "trident", "halls", "doce"])) {
      return { department: "Conveniência", subcategory: "Snacks" };
    }
    if (has(["refrigerante", "coca cola", "suco", "energetico", "red bull", "monster", "agua mineral", "cha pronto", "bebida"])) {
      return { department: "Conveniência", subcategory: "Alimentos e Bebidas" };
    }
    if (has(["pilha", "bateria", "carregador", "fone", "cabo usb", "adaptador"])) {
      return { department: "Conveniência", subcategory: "Acessórios" };
    }
    if (has(["guarda chuva", "isqueiro", "fita adesiva", "chaveiro", "utilidade"])) {
      return { department: "Conveniência", subcategory: "Utilidades" };
    }
    return { department: "Conveniência", subcategory: "Produtos para o Dia a Dia" };
  }

  // 7. SAÚDE E BEM-ESTAR (Vitaminas, Suplementos, Nutracêuticos)
  if (
    has([
      "vitamina", "multivitaminico", "polivitaminico", "lavitan", "centrum", "pharmaton", "vitamina c", "vitamina d", 
      "vitamina b12", "zinco", "ferro", "calcio", "magnesio", "suplemento", "whey", "creatina", "bcaa", "glutamina", 
      "colageno", "omega 3", "probiotico", "propolis", "echinacea", "melatonina", "passiflora", "valeriana", 
      "calmante natural", "emagrecimento", "quitosana", "faseolamina", "spirulina", "shake", "termogenico", 
      "pre treino", "pos treino", "isotonico", "barra de proteina", "amora miura", "oleo de primula", "acido folico", 
      "maca peruana", "tribulus"
    ]) &&
    !has(["dipirona", "amoxicilina", "losartana", "atenolol", "metformina", "omeprazol"])
  ) {
    if (has(["vitamina", "polivitaminico", "multivitaminico", "lavitan", "centrum", "pharmaton", "zinco", "ferro", "calcio", "magnesio", "acido folico"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Vitaminas e Minerais" };
    }
    if (has(["imunidade", "propolis", "echinacea", "extrato de propolis", "vitamina c zinco"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Imunidade" };
    }
    if (has(["sono", "melatonina", "passiflora", "valeriana", "calmante", "relaxante", "dormir"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Sono e Relaxamento" };
    }
    if (has(["energia", "disposicao", "guarana", "cafeina", "coenzima q10", "ginseng"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Energia e Disposição" };
    }
    if (has(["whey", "creatina", "bcaa", "glutamina", "pre treino", "pos treino", "esporte", "hipertrofia", "aminoacido"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Esporte e Performance" };
    }
    if (has(["controle de peso", "emagrecedor", "quitosana", "faseolamina", "spirulina", "shake", "termogenico", "fibra"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Controle de Peso" };
    }
    if (has(["probiotico", "lactobacillus", "enzima digestiva", "flora intestinal"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Saúde Digestiva" };
    }
    if (has(["saude da mulher", "menopausa", "amora", "oleo de primula", "colageno hidrolisado"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Saúde da Mulher" };
    }
    if (has(["saude do homem", "maca peruana", "tribulus", "prostata suplemento"])) {
      return { department: "Saúde e Bem-Estar", subcategory: "Saúde do Homem" };
    }
    return { department: "Saúde e Bem-Estar", subcategory: "Suplementos" };
  }

  // 8. MEDICAMENTOS (Classes farmacológicas específicas)
  // 8.1 Dor e Febre
  if (
    has([
      "dipirona", "paracetamol", "ibuprofeno", "aspirina", "acido acetilsalicilico", "novalgina", "tylenol", 
      "dorflex", "torsilax", "neosaldina", "lisador", "buscopan composto", "cetorolaco", "trometamol", 
      "cetoprofeno", "nimesulida", "diclofenaco", "analgesico", "antitérmico", "antitermico", "anti-inflamatorio", 
      "antiinflamatorio", "toragesic", "cataflam", "voltaren", "spidufen", "alivium", "atover", "tandrilax"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Dor e Febre" };
  }

  // 8.2 Gripe e Resfriado
  if (
    has([
      "antigripal", "gripe", "resfriado", "cimegripe", "coristina", "benegrip", "resfenol", "fluviral", "naldecon", 
      "neosoro", "sorine", "rinosoro", "descongestionante", "xarope tosse", "bisolvon", "vick", "strepsils", 
      "benalet", "ambroxol", "acetilcisteina", "acebrofilina", "cloperastina", "levodropropizina", "pastilha garganta"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Gripe e Resfriado" };
  }

  // 8.3 Alergias
  if (
    has([
      "antialergico", "anti-histaminico", "antihistaminico", "loratadina", "desloratadina", "cetirizina", 
      "levocetirizina", "fexofenadina", "allegra", "ebastina", "dexclorfeniramina", "polaramine", "prednisona", 
      "prednisolona", "dexametasona", "hidrocortisona", "budesonida nasal", "avamys", "busonid", "rinoclenil", 
      "histamin", "celestamine"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Alergias" };
  }

  // 8.4 Saúde Digestiva
  if (
    has([
      "antiacido", "digestivo", "omeprazol", "pantoprazol", "esomeprazol", "rabeprazol", "lansoprazol", "ranitidina", 
      "simeticona", "luftal", "dimeticona", "sal de frutas", "eno", "estomazil", "epocler", "digestil", "plasil", 
      "metoclopramida", "domperidona", "vonau", "ondansetrona", "dramin", "dimenidrinato", "floratil", "loperamida", 
      "imosec", "laxante", "lactulona", "dulcolax", "tamarine", "gutalax", "refluxo", "gastrite", "azia", "enjoo"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Saúde Digestiva" };
  }

  // 8.5 Saúde Respiratória
  if (
    has([
      "bombinha", "aerolin", "salbutamol", "clenil", "alenia", "seretide", "formoterol", "beclometasona", 
      "tiotropio", "ipratropio", "atrovent", "berotec", "fenoterol", "asma", "bronquite", "dpoc", "aerodini"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Saúde Respiratória" };
  }

  // 8.6 Diabetes
  if (
    has([
      "insulina", "metformina", "glifage", "glibenclamida", "gliclazida", "glimepirida", "jardiance", "forxiga", 
      "trayenta", "januvia", "victoza", "ozempic", "rybelsus", "saxenda", "vildagliptina", "dapagliflozina", 
      "empagliflozina", "diabetes", "antidiabetico", "hipoglicemiante"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Diabetes" };
  }

  // 8.7 Pressão e Coração
  if (
    has([
      "losartana", "atenolol", "anlodipino", "hidroclorotiazida", "enalapril", "captopril", "valsartana", 
      "candesartana", "carvedilol", "propranolol", "metoprolol", "nebivolol", "rosuvastatina", "atorvastatina", 
      "sinvastatina", "clopidogrel", "varfarina", "xarelto", "rivaroxabana", "eliquis", "apixabana", 
      "anti-hipertensivo", "pressao alta", "colesterol", "estatina", "anticoagulante", "arritmia"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Pressão e Coração" };
  }

  // 8.8 Saúde da Mulher
  if (
    has([
      "anticoncepcional", "pilula", "yasmin", "yaz", "ciclo 21", "microvlar", "selene", "diane 35", "cerazette", 
      "desogestrel", "levonorgestrel", "pilula do dia seguinte", "ginecologica", "nistatina vaginal", 
      "metronidazol vaginal", "fluconazol", "candidíase", "candidiase", "colpistatina", "ginotrat"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Saúde da Mulher" };
  }

  // 8.9 Saúde do Homem
  if (
    has([
      "tadalafila", "sildenafila", "viagra", "cialis", "finasterida", "dutasterida", "tansulosina", "doxazosina", 
      "proscar", "combodart", "disfuncao eretil", "prostata"
    ])
  ) {
    return { department: "Medicamentos", subcategory: "Saúde do Homem" };
  }

  // 8.10 Outros Medicamentos (Antibióticos, Antiparasitários, etc.)
  if (
    has([
      "antibiotico", "amoxicilina", "azitromicina", "cefalexina", "ciprofloxacino", "clavulanato", "levofloxacino", 
      "albendazol", "ivermectina", "anita", "nitazoxanida", "ciclobenzaprina", "miosan", "colirio", "oftalmico", 
      "oftalmologia", "otologico", "gotas ouvido", "medicamento", "remedio", "farmaco"
    ]) ||
    drugTypeNorm === "generico" ||
    drugTypeNorm === "referencia" ||
    drugTypeNorm === "similar"
  ) {
    return { department: "Medicamentos", subcategory: "Outros Medicamentos" };
  }

  // Default fallback if totally unclassified
  return {
    department: FALLBACK_DEPARTMENT,
    subcategory: FALLBACK_SUBCATEGORY
  };
};
