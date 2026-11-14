export type OfficialStoreDepartment =
  | "Medicamentos"
  | "Saúde e Bem-Estar"
  | "Dermocosméticos e Beleza"
  | "Higiene e Cuidados Pessoais"
  | "Mamãe e Bebê"
  | "Saúde, Ortopedia e Primeiros Socorros"
  | "Conveniência";

export interface CategoryClassificationResult {
  department: OfficialStoreDepartment;
  category: string;
  subcategory: string;
  priority: number;
}

/**
 * Normaliza texto para UPPERCASE sem acentos, preservando espaços e pontos de abreviações
 * de ERP (como "FR.", "SH.", "SHAMP.", "COND.", "CR.PENTEAR", "SAB.LIQ", "ABS.GERIAT", "HAV.")
 * e também gerando versão com delimitadores por espaço para casamento exato de tokens.
 */
export function normalizeForCategoryClassifier(raw?: string | null): {
  rawUpper: string;
  tokenText: string;
} {
  if (!raw) return { rawUpper: "", tokenText: " " };

  const noAccents = String(raw)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Versão compacta preservando pontos, hífens e & (ex: "SH.", "CR.PENTEAR", "COR&TON", "ORAL-B", "BAND-AID")
  const rawUpper = ` ${noAccents.replace(/\s+/g, " ").trim()} `;

  // Versão tokenizada onde qualquer pontuação vira espaço (ex: " FR GERIAT " / " SH ELSEVE ")
  const tokenText = ` ${noAccents.replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;

  return { rawUpper, tokenText };
}

function matchesAnyPattern(
  rawUpper: string,
  tokenText: string,
  patterns: string[],
): boolean {
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    if (p.includes(".") || p.includes("&") || p.includes("-")) {
      if (rawUpper.includes(p)) return true;
    }
    if (rawUpper.includes(p) || tokenText.includes(p)) {
      return true;
    }
  }
  return false;
}

const DIAPER_TRIGGER_PATTERNS = [
  "FRALDA",
  "FR.",
  " FR ",
  "ROUPA INTIMA",
  "ABS.GERIAT",
  "ABS GERIAT",
  "ABSORVENTE GERIAT",
  "PAMPERS",
  "HUGGIES",
  "BABYSEC",
  "MAMYPOKO",
  "TURMA DA MONICA",
  "POMPOM",
  "PERSONAL BABY",
  "PLENITUD",
  "TENA ",
  "BIGFRAL",
  "BIOFRAL",
  "COTIDIAN",
  "CONFORT MASTER",
];

const ADULT_DIAPER_PATTERNS = [
  "GERIAT",
  "ADULTO",
  "PLENITUD",
  " TENA ",
  "BIGFRAL",
  "BIOFRAL",
  "COTIDIAN",
  "CONFORT MASTER",
  "INCONTINENCIA",
  "ROUPA INTIMA",
  "ABS.GERIAT",
  "ABS GERIAT",
  "IDOSO",
  "TERCEIRA IDADE",
];

const INFANT_DIAPER_PATTERNS = [
  "PAMPERS",
  "HUGGIES",
  "BABYSEC",
  "MAMYPOKO",
  "TURMA DA MONICA",
  "POMPOM",
  "PERSONAL BABY",
  "CREMER",
  " BABY",
  "INFANTIL",
  " RN ",
  " RN+",
  "HIPER",
  "JUMBO",
  "MEGA",
  "BEBE",
  "RECEM NASCIDO",
];

const BABY_CARE_PATTERNS = [
  "MAMADEIRA",
  "CHUPETA",
  "MORDEDOR",
  "BICO SILICONE",
  "LENCO UMED",
  "TOALHA UMED",
  "POMADA ASSADURA",
  "HIPOGLOSS",
  "HIPOGLOS",
  "BEPANTOL BABY",
  "GRANADO BEBE",
  "JOHNSONS BABY",
  "JOHNSON BABY",
  "MUSTELA BEBE",
  "DESITIN",
  "FORMULA INFANTIL",
  " NAN ",
  "NAN SUPREME",
  "NAN COMFOR",
  "NAN SCIENCE",
  "APTAMIL",
  "NESTOGENO",
  "ENFAMIL",
  "MUCILON",
  "LEITE INFANTIL",
  "COMPOSTO LACTEO",
  "ABSORVENTE SEIOS",
  "CONCHA AMAMENTACAO",
  "BOMBA TIRA LEITE",
  "SHAMPOO BEBE",
  "SABONETE BEBE",
  "COLONIA BEBE",
];

const DERMOCOSMETICS_AND_SOLAR_PATTERNS = [
  "PROTETOR SOLAR",
  "FILTRO SOLAR",
  "BLOQUEADOR SOLAR",
  " FPS",
  "FPS ",
  "LA ROCHE",
  "LAROCHE",
  "ANTHELIOS",
  "VICHY",
  "AVENE",
  "CERAVE",
  "CETAPHIL",
  "ISDIN",
  "EPISOL",
  "ANASOL",
  "SUNDOWN",
  "MINESOL",
  "NEUTROGENA",
  "BIODERMA",
  "MANTECORP",
  "PRINCIPIA",
  "SALLVE",
  "AGUA MICELAR",
  "SERUM FACIAL",
  "SERUM ",
  "ACIDO HIALURONICO",
  "RETINOL",
  "HIDRATANTE FACIAL",
  "GEL DE LIMPEZA FACIAL",
  "SABONETE FACIAL",
  "ANTIRRUGAS",
  "ANTI-IDADE",
  "CICATRICURE",
  "ASEPXIA",
];

const HAIR_AND_BEAUTY_PATTERNS = [
  "SHAMPOO",
  "SHAMP.",
  " SHAMP ",
  " SH.",
  " SH ",
  "CONDICIONADOR",
  "COND.",
  " COND ",
  "CREME DE PENTEAR",
  "CREME PARA PENTEAR",
  "CR.PENTEAR",
  "CR PENTEAR",
  "MASCARA CAPILAR",
  "MASC.CAPILAR",
  "LEAVE-IN",
  "LEAVE IN",
  "REPARADOR DE PONTAS",
  "OLEO CAPILAR",
  "TONICO CAPILAR",
  "TINTURA",
  "TINT.",
  " TINT ",
  "COLORACAO",
  "TONALIZANTE",
  "COR&TON",
  "COR E TON",
  "KOLESTON",
  "BIOCOLOR",
  "IMEDIA",
  "GARNIER NUTRISSE",
  "ELSEVE",
  "PANTENE",
  "TRESEMME",
  "SALON LINE",
  "SKALA",
  "NOVEX",
  "HEAD & SHOULDERS",
  "HEAD SHOULDERS",
  "ESMALTE",
  "ACETONA",
  "REMOVEDOR DE ESMALTE",
  "RISQUE",
  "IMPALA",
  "COLORAMA",
  "DAILUS",
  "ALICATE DE UNHA",
  "ALICATE UNHA",
  "LIXA DE UNHA",
  "LIXA UNHA",
  "BATOM",
  "RIMEL",
  "MASCARA DE CILIOS",
  "BASE FACIAL",
  "CORRETIVO FACIAL",
  "PO COMPACTO",
  "DELINEADOR",
  "GLOSS LABIAL",
  "HIDRATANTE LABIAL",
  "MANTEIGA DE CACAU",
  "HIDRATANTE CORPORAL",
  "LOCAO HIDRATANTE",
  "LOCAO CORPORAL",
  "OLEO CORPORAL",
  "DEO COLONIA",
  "BODY SPLASH",
  "PERFUME",
];

const PERSONAL_HYGIENE_PATTERNS = [
  "DESODORANTE",
  "DESOD.",
  " DESOD ",
  "ANTITRANSPIRANTE",
  "REXONA",
  "DOVE",
  "NIVEA",
  "ABOVE",
  "MONANGE",
  "HERBISSIMO",
  "OLD SPICE",
  " AXE ",
  "BOZZANO",
  "ROLL-ON",
  "ROLL ON",
  "SABONETE",
  "SAB.LIQ",
  "SAB LIQ",
  "SAB.GLICERINA",
  "SAB GLICERINA",
  "SAB.BARRA",
  "SAB BARRA",
  "PROTEX",
  "PALMOLIVE",
  "PHEBO",
  "LUX ",
  "DERMACYD",
  "SABONETE INTIMO",
  "SAB.INTIMO",
  "ABSORVENTE",
  "ABS.EXT",
  "ABS.INT",
  "ABS.DIARIO",
  "ABS.NOTURNO",
  "ABS.",
  "INTIMUS",
  "ALWAYS",
  "SEMPRE LIVRE",
  "KOTEX",
  "CAREFREE",
  "PROTETOR DIARIO",
  "COLETOR MENSTRUAL",
  "ESCOVA DENTAL",
  "ESC.DENTAL",
  "ESCOVA DE DENTE",
  "CR.DENTAL",
  "CR DENTAL",
  "CREME DENTAL",
  "GEL DENTAL",
  "PASTA DE DENTE",
  "FIO DENTAL",
  "FITA DENTAL",
  "COLGATE",
  "ORAL-B",
  "ORAL B",
  "SORRISO",
  "CLOSEUP",
  "CLOSE UP",
  "SENSODYNE",
  "PARODONTAX",
  "COREGA",
  "ELMEX",
  "CURAPROX",
  "ENXAGUANTE BUCAL",
  "ANTISSEPTICO BUCAL",
  "LISTERINE",
  "ALGODAO",
  "HASTE FLEX",
  "HASTES FLEXIVEIS",
  "COTONETE",
  "PAPEL HIGIENICO",
  "LENCO DE PAPEL",
];

const CONVENIENCE_PATTERNS = [
  "HAV.",
  "HAVAIANAS",
  "CHINELO",
  "SANDALIA",
  "CHAVEIRO",
  "PILHA",
  "BATERIA",
  "BARBEADOR",
  "APARELHO DE BARBEAR",
  "AP.BARBEAR",
  "LAMINA DE BARBEAR",
  "PRESTOBARBA",
  "MACH3",
  "GILLETTE",
  " BALA ",
  "BALAS ",
  "CHICLETE",
  "GOMA DE MASCAR",
  "HALLS",
  "TRIDENT",
  "MENTOS",
  "TIC TAC",
  "PIRULITO",
  "CHOCOLATE",
  "BOMBOM",
  "KITKAT",
  "BARRA DE CEREAL",
  "REFRIGERANTE",
  "COCA COLA",
  "AGUA MINERAL",
  "AGUA DE COCO",
  "ENERGETICO",
  "RED BULL",
  "MONSTER",
  "GATORADE",
  "ISQUEIRO",
  "GUARDA CHUVA",
  "ADOCANTE",
  "ZERO CAL",
  "REPELENTE",
  "EXPOSIS",
  " OFF ",
];

const VITAMINS_AND_SUPPLEMENTS_PATTERNS = [
  "VITAMINA",
  "VIT.",
  " VIT ",
  "POLIVITAMINICO",
  "MULTIVITAMINICO",
  "LAVITAN",
  "CENTRUM",
  "PHARMATON",
  "SUPRADYN",
  "TARGIFOR",
  "OMEGA 3",
  "OMEGA-3",
  "CREATINA",
  "WHEY",
  "BCAA",
  "GLUTAMINA",
  "COLAGENO",
  "MELATONINA",
  "IMECAP",
  "PROPOLIS",
  "COENZIMA Q10",
  "BIOTINA",
  "CLORETO DE MAGNESIO",
  "MAGNESIO DIMALATO",
  "MAGNESIO INOSITOL",
  "TREONATO",
  "SUPLEMENTO ALIMENTAR",
  "SUPLEMENTO VITAMINICO",
  "CALCIO + VIT",
  "OSTEO",
];

const FIRST_AID_AND_ORTHOPEDICS_PATTERNS = [
  "CURATIVO",
  "BAND-AID",
  "BAND AID",
  "ESPARADRAPO",
  "MICROPORE",
  "FITA CIRURGICA",
  "GAZE",
  "ATADURA",
  "SORO FISIOLOGICO",
  "ALCOOL 70",
  "AGUA OXIGENADA 10V",
  "MERTHIOLATE",
  "POVIDINE",
  "CLOREXIDINA",
  "TERMOMETRO",
  "APARELHO PRESSAO",
  "APARELHO DE PRESSAO",
  "ESFIGMOMANOMETRO",
  "NEBULIZADOR",
  "INALADOR",
  "OXIMETRO",
  "GLICOSIMETRO",
  "TIRA REAGENTE",
  "TIRAS REAGENTES",
  "LANCETA",
  "SERINGA",
  "AGULHA",
  "SCALP",
  "CATETER",
  "COLETOR UNIVERSAL",
  "LUVA DESCARTAVEL",
  "LUVA PROCEDIMENTO",
  "MASCARA DESCARTAVEL",
  "TALA ",
  "JOELHEIRA",
  "MUNHEQUEIRA",
  "TORNOZELEIRA",
  "TIPOIA",
  "CINTA LOMBAR",
  "COLAR CERVICAL",
  "MEIA DE COMPRESSAO",
  "KENDALL",
  "SIGVARIS",
  "BENGALA",
  "MULETA",
  "BOLSA TERMICA",
  "PRESERVATIVO",
  "CAMISINHA",
  "JONTEX",
  "PRUDENCE",
  "OLLA",
  "BLOWTEX",
  "LUBRIFICANTE INTIMO",
  "K-MED",
  "TESTE DE GRAVIDEZ",
  "TESTE RAPIDO GRAVIDEZ",
  "CLEARBLUE",
  "CONFIRME",
];

const MEDICATION_FORM_PATTERNS = [
  " MG ",
  "MG/",
  "MCG",
  " COMP",
  " CP ",
  " C/10",
  " C/12",
  " C/15",
  " C/20",
  " C/30",
  " C/60",
  "CAPS",
  "DRG",
  " GTS",
  "GOTAS",
  "XAROPE",
  " XPE ",
  "SUSP ",
  "SUSPENSAO",
  "POMADA",
  "CREME DERM",
  "GEL DERM",
  "AMPOLA",
  "INJETAVEL",
  "COLIRIO",
  "SOLUCAO NASAL",
  "SPRAY NASAL",
];

/**
 * Classifica um produto farmacêutico/varejo aplicando as 8 Regras de Prioridade Estritas
 * sobre o nome do produto (`productName`) e marca/fabricante (`brand`), ignorando
 * categorias genéricas ou equivocadas vindas do ERP ("OUTROS MEDICAMENTOS", etc.).
 */
export function classifyProductCategory(
  productName: string,
  brand?: string,
  currentErpCategory?: string,
): CategoryClassificationResult {
  const combinedInput = `${productName || ""} ${brand || ""}`.trim();
  const { rawUpper, tokenText } = normalizeForCategoryClassifier(combinedInput);
  const erpCatNorm = normalizeForCategoryClassifier(currentErpCategory || "");

  // =========================================================================
  // PRIORIDADE 1: FRALDAS (Separar estritamente Infantil vs. Adulto/Geriátrico)
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, DIAPER_TRIGGER_PATTERNS)) {
    // 1A. Verifica primeiro termos Adultos/Geriátricos (NUNCA classificar como Infantil)
    if (matchesAnyPattern(rawUpper, tokenText, ADULT_DIAPER_PATTERNS)) {
      return {
        department: "Saúde, Ortopedia e Primeiros Socorros",
        category: "Cuidados Adulto / Geriátrico",
        subcategory: "Cuidados Adulto / Geriátrico",
        priority: 1,
      };
    }

    // 1B. Verifica termos Infantis ou fraldas sem indicador geriátrico
    if (
      matchesAnyPattern(rawUpper, tokenText, INFANT_DIAPER_PATTERNS) ||
      matchesAnyPattern(rawUpper, tokenText, ["FRALDA", "FR.", " FR "])
    ) {
      return {
        department: "Mamãe e Bebê",
        category: "Fraldas Infantis",
        subcategory: "Fraldas Infantis",
        priority: 1,
      };
    }
  }

  // =========================================================================
  // PRIORIDADE 2: MAMÃE E BEBÊ (Outros itens infantis e maternidade)
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, BABY_CARE_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "FORMULA INFANTIL",
        " NAN ",
        "NAN SUPREME",
        "NAN COMFOR",
        "APTAMIL",
        "NESTOGENO",
        "ENFAMIL",
        "MUCILON",
        "LEITE INFANTIL",
        "COMPOSTO LACTEO",
      ])
    ) {
      return {
        department: "Mamãe e Bebê",
        category: "Alimentação Infantil",
        subcategory: "Alimentação Infantil",
        priority: 2,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "ABSORVENTE SEIOS",
        "CONCHA AMAMENTACAO",
        "BOMBA TIRA LEITE",
      ])
    ) {
      return {
        department: "Mamãe e Bebê",
        category: "Amamentação",
        subcategory: "Amamentação",
        priority: 2,
      };
    }

    return {
      department: "Mamãe e Bebê",
      category: "Higiene do Bebê",
      subcategory: "Higiene do Bebê",
      priority: 2,
    };
  }

  // =========================================================================
  // PRIORIDADE 4 (antes de Higiene geral quando for solar/dermo):
  // DERMOCOSMÉTICOS E PROTEÇÃO SOLAR
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, DERMOCOSMETICS_AND_SOLAR_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "PROTETOR SOLAR",
        "FILTRO SOLAR",
        "BLOQUEADOR SOLAR",
        " FPS",
        "FPS ",
        "ANTHELIOS",
        "EPISOL",
        "ANASOL",
        "SUNDOWN",
        "MINESOL",
      ])
    ) {
      return {
        department: "Dermocosméticos e Beleza",
        category: "Proteção Solar",
        subcategory: "Proteção Solar",
        priority: 4,
      };
    }

    return {
      department: "Dermocosméticos e Beleza",
      category: "Cuidados com o Rosto",
      subcategory: "Cuidados com o Rosto",
      priority: 4,
    };
  }

  // =========================================================================
  // PRIORIDADE 3: HIGIENE, CABELOS E BELEZA (Tirar Shampoos/Sabonetes de Medicamentos!)
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, HAIR_AND_BEAUTY_PATTERNS)) {
    // Exceção apenas se for claramente shampoo medicamentoso antifúngico sob prescrição (ex: Cetoconazol 20mg/g)
    // Mas mesmo shampoos cosméticos/anticaspa comuns ficam em Cabelos
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "SHAMPOO",
        "SHAMP.",
        " SHAMP ",
        " SH.",
        " SH ",
        "CONDICIONADOR",
        "COND.",
        " COND ",
        "CREME DE PENTEAR",
        "CREME PARA PENTEAR",
        "CR.PENTEAR",
        "CR PENTEAR",
        "MASCARA CAPILAR",
        "MASC.CAPILAR",
        "LEAVE-IN",
        "LEAVE IN",
        "REPARADOR DE PONTAS",
        "OLEO CAPILAR",
        "TONICO CAPILAR",
        "TINTURA",
        "TINT.",
        " TINT ",
        "COLORACAO",
        "TONALIZANTE",
        "COR&TON",
        "COR E TON",
        "KOLESTON",
        "BIOCOLOR",
        "IMEDIA",
        "GARNIER NUTRISSE",
        "ELSEVE",
        "PANTENE",
        "TRESEMME",
        "SALON LINE",
        "SKALA",
        "NOVEX",
        "HEAD & SHOULDERS",
        "HEAD SHOULDERS",
      ])
    ) {
      return {
        department: "Dermocosméticos e Beleza",
        category: "Cabelos",
        subcategory: "Cabelos",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "ESMALTE",
        "ACETONA",
        "REMOVEDOR DE ESMALTE",
        "RISQUE",
        "IMPALA",
        "COLORAMA",
        "DAILUS",
        "ALICATE DE UNHA",
        "ALICATE UNHA",
        "LIXA DE UNHA",
        "LIXA UNHA",
      ])
    ) {
      return {
        department: "Dermocosméticos e Beleza",
        category: "Cuidados com as Unhas",
        subcategory: "Cuidados com as Unhas",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "BATOM",
        "RIMEL",
        "MASCARA DE CILIOS",
        "BASE FACIAL",
        "CORRETIVO FACIAL",
        "PO COMPACTO",
        "DELINEADOR",
        "GLOSS LABIAL",
        "HIDRATANTE LABIAL",
        "MANTEIGA DE CACAU",
      ])
    ) {
      return {
        department: "Dermocosméticos e Beleza",
        category: "Maquiagem",
        subcategory: "Maquiagem",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "DEO COLONIA",
        "BODY SPLASH",
        "PERFUME",
      ])
    ) {
      return {
        department: "Dermocosméticos e Beleza",
        category: "Perfumes",
        subcategory: "Perfumes",
        priority: 3,
      };
    }

    return {
      department: "Dermocosméticos e Beleza",
      category: "Cuidados com o Corpo",
      subcategory: "Cuidados com o Corpo",
      priority: 3,
    };
  }

  if (matchesAnyPattern(rawUpper, tokenText, PERSONAL_HYGIENE_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "ESCOVA DENTAL",
        "ESC.DENTAL",
        "ESCOVA DE DENTE",
        "CR.DENTAL",
        "CR DENTAL",
        "CREME DENTAL",
        "GEL DENTAL",
        "PASTA DE DENTE",
        "FIO DENTAL",
        "FITA DENTAL",
        "COLGATE",
        "ORAL-B",
        "ORAL B",
        "SORRISO",
        "CLOSEUP",
        "CLOSE UP",
        "SENSODYNE",
        "PARODONTAX",
        "COREGA",
        "ELMEX",
        "CURAPROX",
        "ENXAGUANTE BUCAL",
        "ANTISSEPTICO BUCAL",
        "LISTERINE",
      ])
    ) {
      return {
        department: "Higiene e Cuidados Pessoais",
        category: "Higiene Bucal",
        subcategory: "Higiene Bucal",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "DESODORANTE",
        "DESOD.",
        " DESOD ",
        "ANTITRANSPIRANTE",
        "REXONA",
        "ABOVE",
        "MONANGE",
        "HERBISSIMO",
        "OLD SPICE",
        " AXE ",
        "BOZZANO",
        "ROLL-ON",
        "ROLL ON",
      ])
    ) {
      return {
        department: "Higiene e Cuidados Pessoais",
        category: "Desodorantes",
        subcategory: "Desodorantes",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "ABSORVENTE",
        "ABS.EXT",
        "ABS.INT",
        "ABS.DIARIO",
        "ABS.NOTURNO",
        "ABS.",
        "INTIMUS",
        "ALWAYS",
        "SEMPRE LIVRE",
        "KOTEX",
        "CAREFREE",
        "PROTETOR DIARIO",
        "COLETOR MENSTRUAL",
      ])
    ) {
      return {
        department: "Higiene e Cuidados Pessoais",
        category: "Absorventes e Cuidados Femininos",
        subcategory: "Absorventes e Cuidados Femininos",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "SABONETE INTIMO",
        "SAB.INTIMO",
        "DERMACYD",
      ])
    ) {
      return {
        department: "Higiene e Cuidados Pessoais",
        category: "Higiene Íntima",
        subcategory: "Higiene Íntima",
        priority: 3,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "ALGODAO",
        "HASTE FLEX",
        "HASTES FLEXIVEIS",
        "COTONETE",
        "PAPEL HIGIENICO",
        "LENCO DE PAPEL",
      ])
    ) {
      return {
        department: "Higiene e Cuidados Pessoais",
        category: "Lenços e Algodão",
        subcategory: "Lenços e Algodão",
        priority: 3,
      };
    }

    return {
      department: "Higiene e Cuidados Pessoais",
      category: "Banho e Corpo",
      subcategory: "Banho e Corpo",
      priority: 3,
    };
  }

  // =========================================================================
  // PRIORIDADE 5: CONVENIÊNCIA E CALÇADOS (Havaianas, Chinelos, Barbeadores, Balas, Pilhas)
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, CONVENIENCE_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "BARBEADOR",
        "APARELHO DE BARBEAR",
        "AP.BARBEAR",
        "LAMINA DE BARBEAR",
        "PRESTOBARBA",
        "MACH3",
        "GILLETTE",
      ])
    ) {
      return {
        department: "Conveniência",
        category: "Produtos para o Dia a Dia",
        subcategory: "Produtos para o Dia a Dia",
        priority: 5,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        " BALA ",
        "BALAS ",
        "CHICLETE",
        "GOMA DE MASCAR",
        "HALLS",
        "TRIDENT",
        "MENTOS",
        "TIC TAC",
        "PIRULITO",
        "CHOCOLATE",
        "BOMBOM",
        "KITKAT",
        "BARRA DE CEREAL",
      ])
    ) {
      return {
        department: "Conveniência",
        category: "Snacks",
        subcategory: "Snacks",
        priority: 5,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "REFRIGERANTE",
        "COCA COLA",
        "AGUA MINERAL",
        "AGUA DE COCO",
        "ENERGETICO",
        "RED BULL",
        "MONSTER",
        "GATORADE",
        "ADOCANTE",
        "ZERO CAL",
      ])
    ) {
      return {
        department: "Conveniência",
        category: "Alimentos e Bebidas",
        subcategory: "Alimentos e Bebidas",
        priority: 5,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "HAV.",
        "HAVAIANAS",
        "CHINELO",
        "SANDALIA",
        "CHAVEIRO",
        "PILHA",
        "BATERIA",
      ])
    ) {
      return {
        department: "Conveniência",
        category: "Utilidades",
        subcategory: "Utilidades",
        priority: 5,
      };
    }

    return {
      department: "Conveniência",
      category: "Produtos para o Dia a Dia",
      subcategory: "Produtos para o Dia a Dia",
      priority: 5,
    };
  }

  // =========================================================================
  // PRIORIDADE 6: VITAMINAS E SUPLEMENTOS
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, VITAMINS_AND_SUPPLEMENTS_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "CREATINA",
        "WHEY",
        "BCAA",
        "GLUTAMINA",
      ])
    ) {
      return {
        department: "Saúde e Bem-Estar",
        category: "Suplementos",
        subcategory: "Suplementos",
        priority: 6,
      };
    }

    if (matchesAnyPattern(rawUpper, tokenText, ["MELATONINA"])) {
      return {
        department: "Saúde e Bem-Estar",
        category: "Sono e Relaxamento",
        subcategory: "Sono e Relaxamento",
        priority: 6,
      };
    }

    return {
      department: "Saúde e Bem-Estar",
      category: "Vitaminas e Suplementos",
      subcategory: "Vitaminas e Suplementos",
      priority: 6,
    };
  }

  // =========================================================================
  // PRIORIDADE 7: PRIMEIROS SOCORROS E ORTOPEDIA
  // =========================================================================
  if (matchesAnyPattern(rawUpper, tokenText, FIRST_AID_AND_ORTHOPEDICS_PATTERNS)) {
    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "TALA ",
        "JOELHEIRA",
        "MUNHEQUEIRA",
        "TORNOZELEIRA",
        "TIPOIA",
        "CINTA LOMBAR",
        "COLAR CERVICAL",
        "MEIA DE COMPRESSAO",
        "KENDALL",
        "SIGVARIS",
        "BENGALA",
        "MULETA",
      ])
    ) {
      return {
        department: "Saúde, Ortopedia e Primeiros Socorros",
        category: "Ortopédicos",
        subcategory: "Ortopédicos",
        priority: 7,
      };
    }

    if (
      matchesAnyPattern(rawUpper, tokenText, [
        "TERMOMETRO",
        "APARELHO PRESSAO",
        "APARELHO DE PRESSAO",
        "ESFIGMOMANOMETRO",
        "NEBULIZADOR",
        "INALADOR",
        "OXIMETRO",
        "GLICOSIMETRO",
        "TIRA REAGENTE",
        "TIRAS REAGENTES",
        "LANCETA",
      ])
    ) {
      return {
        department: "Saúde, Ortopedia e Primeiros Socorros",
        category: "Aparelhos de Saúde",
        subcategory: "Aparelhos de Saúde",
        priority: 7,
      };
    }

    return {
      department: "Saúde, Ortopedia e Primeiros Socorros",
      category: "Primeiros Socorros",
      subcategory: "Primeiros Socorros",
      priority: 7,
    };
  }

  // =========================================================================
  // PRIORIDADE 8: MEDICAMENTOS (Classes terapêuticas e apresentações farmacêuticas)
  // =========================================================================
  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "DIPIRONA",
      "PARACETAMOL",
      "IBUPROFENO",
      "ASPIRINA",
      "NOVALGINA",
      "TYLENOL",
      "DORFLEX",
      "TORSILAX",
      "NEOSALDINA",
      "LISADOR",
      "BUSCOPAN",
      "CETOPROFENO",
      "NIMESULIDA",
      "DICLOFENACO",
      "TORAGESIC",
      "CATAFLAM",
      "VOLTAREN",
      "ALIVIUM",
      "TANDRILAX",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Dor e Febre",
      subcategory: "Dor e Febre",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "CIMEGRIPE",
      "CORISTINA",
      "BENEGRIP",
      "RESFENOL",
      "FLUVIRAL",
      "NALDECON",
      "NEOSORO",
      "SORINE",
      "RINOSORO",
      "BISOLVON",
      "VICK",
      "STREPSILS",
      "CIFLOGEX",
      "BENALET",
      "AMBROXOL",
      "ACETILCISTEINA",
      "ACEBROFILINA",
      "ANTIGRIPAL",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Gripe e Resfriado",
      subcategory: "Gripe e Resfriado",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "LORATADINA",
      "DESLORATADINA",
      "CETIRIZINA",
      "FEXOFENADINA",
      "ALLEGRA",
      "POLARAMINE",
      "DEXCLORFENIRAMINA",
      "PREDNISONA",
      "PREDNISOLONA",
      "DEXAMETASONA",
      "HIDROCORTISONA",
      "BUDESONIDA",
      "AVAMYS",
      "BUSONID",
      "HISTAMIN",
      "CELESTAMINE",
      "ANTIALERGICO",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Alergias",
      subcategory: "Alergias",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "OMEPRAZOL",
      "PANTOPRAZOL",
      "ESOMEPRAZOL",
      "SIMETICONA",
      "LUFTAL",
      "SAL DE FRUTAS",
      " ENO ",
      "ESTOMAZIL",
      "EPOCLER",
      "PLASIL",
      "METOCLOPRAMIDA",
      "DOMPERIDONA",
      "VONAU",
      "ONDANSETRONA",
      "DRAMIN",
      "FLORATIL",
      "LOPERAMIDA",
      "IMOSEC",
      "LACTULONA",
      "DULCOLAX",
      "TAMARINE",
      "GUTALAX",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Saúde Digestiva",
      subcategory: "Saúde Digestiva",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "AEROLIN",
      "SALBUTAMOL",
      "CLENIL",
      "ALENIA",
      "SERETIDE",
      "FORMOTEROL",
      "BECLOMETASONA",
      "ATROVENT",
      "BEROTEC",
      "FENOTEROL",
      "AERODINI",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Saúde Respiratória",
      subcategory: "Saúde Respiratória",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "INSULINA",
      "METFORMINA",
      "GLIFAGE",
      "GLIBENCLAMIDA",
      "GLICLAZIDA",
      "GLIMEPIRIDA",
      "JARDIANCE",
      "FORXIGA",
      "TRAYENTA",
      "JANUVIA",
      "OZEMPIC",
      "RYBELSUS",
      "SAXENDA",
      "DAPAGLIFLOZINA",
      "EMPAGLIFLOZINA",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Diabetes",
      subcategory: "Diabetes",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "LOSARTANA",
      "ATENOLOL",
      "ANLODIPINO",
      "HIDROCLOROTIAZIDA",
      "ENALAPRIL",
      "CAPTOPRIL",
      "VALSARTANA",
      "CANDESARTANA",
      "CARVEDILOL",
      "PROPRANOLOL",
      "METOPROLOL",
      "NEBIVOLOL",
      "ROSUVASTATINA",
      "ATORVASTATINA",
      "SINVASTATINA",
      "CLOPIDOGREL",
      "XARELTO",
      "RIVAROXABANA",
      "ELIQUIS",
      "APIXABANA",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Pressão e Coração",
      subcategory: "Pressão e Coração",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "YASMIN",
      " YAZ ",
      "CICLO 21",
      "MICROVLAR",
      "SELENE",
      "DIANE 35",
      "CERAZETTE",
      "DESOGESTREL",
      "LEVONORGESTREL",
      "NISTATINA VAGINAL",
      "METRONIDAZOL VAGINAL",
      "FLUCONAZOL",
      "ANTICONCEPCIONAL",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Saúde da Mulher",
      subcategory: "Saúde da Mulher",
      priority: 8,
    };
  }

  if (
    matchesAnyPattern(rawUpper, tokenText, [
      "TADALAFILA",
      "SILDENAFILA",
      "VIAGRA",
      "CIALIS",
      "FINASTERIDA",
      "DUTASTERIDA",
      "TANSULOSINA",
      "DOXAZOSINA",
    ])
  ) {
    return {
      department: "Medicamentos",
      category: "Saúde do Homem",
      subcategory: "Saúde do Homem",
      priority: 8,
    };
  }

  // Se o ERP indicou Perfumaria/Cosméticos/Higiene mas não bateu em indicadores de medicamento
  if (
    !matchesAnyPattern(rawUpper, tokenText, MEDICATION_FORM_PATTERNS) &&
    matchesAnyPattern(erpCatNorm.rawUpper, erpCatNorm.tokenText, [
      "PERFUMARIA",
      "COSMETICO",
      "HIGIENE",
      "BELEZA",
    ])
  ) {
    return {
      department: "Higiene e Cuidados Pessoais",
      category: "Higiene e Beleza",
      subcategory: "Higiene e Beleza",
      priority: 8,
    };
  }

  return {
    department: "Medicamentos",
    category: "Outros Medicamentos",
    subcategory: "Outros Medicamentos",
    priority: 8,
  };
}
