import { DepartmentConfig } from '../types';

export const DEPARTMENT_MAPPING: Record<string, string[]> = {
  "Medicamentos": ["medicamento", "referência", "referencia", "genérico", "generico", "antibiótico", "antibiotico", "analgésico", "analgesico", "anti-inflamatório", "xarope", "colírio", "colirio", "pomada", "receita"],
  "Higiene e Banho": ["higiene", "banho", "sabonete", "desodorante", "cuidados diários", "cuidados diarios", "bucal", "dental", "creme dental", "escova", "absorvente", "íntima", "intima", "barba", "depilação", "depilacao"],
  "Beleza e Dermo": ["beleza", "dermocosmético", "dermocosmetico", "rosto", "cabelo", "maquiagem", "pele", "protetor solar", "anti-idade", "hidratante", "skincare", "perfumaria", "unha", "esmalte", "cosmético", "cosmetico"],
  "Mamãe e Bebê": ["mamãe", "mamae", "bebê", "bebe", "fralda", "fórmula", "formula", "infantil", "criança", "crianca", "chupeta", "mamadeira", "lenço umedecido", "lenco", "assadura"],
  "Bem-estar e Vitaminas": ["bem-estar", "bem estar", "vitamina", "suplemento", "polivitamínico", "polivitaminico", "imunidade", "emagrecimento", "nutrição", "nutricao"],
  "Cuidados com a Saúde": ["saúde", "saude", "primeiros socorros", "aparelho", "ortopédico", "ortopedico", "pressão", "pressao", "termômetro", "termometro", "curativo", "atadura", "seringa", "teste", "preservativo", "incontinência", "incontinencia"],
  "Conveniência": ["conveniência", "conveniencia", "alimento", "bebida", "snack", "bala", "doce", "água", "agua", "chocolate"],
};

export const FALLBACK_DEPARTMENT = "Outros";

export const getDepartmentForCategory = (category: string, customDepartments?: DepartmentConfig[]): string => {
    if (!category) return FALLBACK_DEPARTMENT;
    const lowerCat = category.toLowerCase().trim();
    
    if (customDepartments && customDepartments.length > 0) {
        // Find if any custom department exactly maps this category
        const exactMatch = customDepartments.find(d => 
            d.categories.some(c => c.toLowerCase().trim() === lowerCat)
        );
        if (exactMatch) return exactMatch.name;
        
        // Find if any custom department keyword matches
        for (const dept of customDepartments) {
             if (dept.categories.some(k => k && (lowerCat.includes(k.toLowerCase()) || k.toLowerCase().includes(lowerCat)))) {
                 return dept.name;
             }
        }
    }
    
    // Always fallback to default mapping if custom not found or not present
    for (const [dept, keywords] of Object.entries(DEPARTMENT_MAPPING)) {
        if (keywords.some(k => lowerCat.includes(k) || k.includes(lowerCat))) {
            return dept;
        }
    }
    
    return FALLBACK_DEPARTMENT;
};
