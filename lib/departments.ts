import { DepartmentConfig } from '../types';
import { classifyProductCategory } from '../services/categoryClassifier';

export { classifyProductCategory };

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
    "Vitaminas e Suplementos",
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
    "Lenços e Algodão",
    "Higiene e Beleza"
  ],
  "Mamãe e Bebê": [
    "Fraldas Infantis",
    "Fraldas",
    "Higiene do Bebê",
    "Alimentação Infantil",
    "Amamentação",
    "Cuidados com a Mamãe"
  ],
  "Saúde, Ortopedia e Primeiros Socorros": [
    "Cuidados Adulto / Geriátrico",
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

  // Caso seja categoria herdada ou bruta, roda o classificador estrito
  const classified = classifyProductCategory(category, "", "");
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
 * Motor Inteligente e Determinístico de Classificação Taxonômica FarmaFlow.
 * Delega integralmente para `classifyProductCategory` (com Regra de Ouro de blindagem
 * de medicamentos/laboratórios e Regex estrito com `\b` word boundary), eliminando
 * falsos positivos em "Snacks" e "Produtos para o Dia a Dia".
 */
export const classifyProductTaxonomy = (
  input: ProductClassificationInput
): ProductClassificationResult => {
  const result = classifyProductCategory(
    input.name || "",
    input.manufacturer || "",
    input.rawCategory || "",
    input.activePrinciple || "",
    `${input.description || ""} ${input.indications || ""}`.trim(),
    input.drugType || ""
  );

  return {
    department: result.department,
    subcategory: result.subcategory
  };
};
