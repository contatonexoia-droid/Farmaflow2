
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { OFFICIAL_DEPARTMENTS, OFFICIAL_TAXONOMY, classifyProductTaxonomy } from "../lib/departments.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error.status || error.code;
    const message = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
    
    // Se for erro de cota 429 ou RESOURCE_EXHAUSTED
    if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      // Se for limite de cota DIÁRIA/MENSAL, não adianta tentar de novo
      if (message.includes("limit: 0") || message.includes("quota")) {
        throw new Error("LIMITE_IA_ATINGIDO");
      }
      
      // Se for RESOURCE_EXHAUSTED sem menção de quota, provavelmente é Rate Limit (RPM), então tentamos de novo
      if (retries > 0) {
        await wait(delay);
        return retryWithBackoff(fn, retries - 1, delay * factor, factor);
      }
    }
    
    // Erro de permissão 403
    if (status === 403 || message.includes('403')) {
      throw new Error("SEM_PERMISSAO_MODELO");
    }
    
    // Erros de autenticação (401)
    if (status === 401) throw error;
    
    if (retries > 0) {
      await wait(delay);
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

const cleanJsonResponse = (text: string): string => {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    }
    return cleaned;
};

export const fetchProductDetailsBatch = async (productsToEnrich: { name: string, missingFields: string[] }[]) => {
  if (productsToEnrich.length === 0) return [];
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analise os seguintes produtos farmacêuticos/varejo e retorne APENAS os campos solicitados em 'missingFields' para cada um: ${JSON.stringify(productsToEnrich)}. 
      Para cada produto, retorne um objeto com os campos solicitados.
      
      DIRETRIZES ESTRITAS DE DEPARTAMENTO E CATEGORIA:
      1. department: DEVE ser EXATAMENTE um dos 7 Departamentos Oficiais:
         ['Medicamentos', 'Saúde e Bem-Estar', 'Dermocosméticos e Beleza', 'Higiene e Cuidados Pessoais', 'Mamãe e Bebê', 'Saúde, Ortopedia e Primeiros Socorros', 'Conveniência']
      2. category: DEVE ser EXATAMENTE uma das Subcategorias Oficiais correspondentes ao departamento:
         - Medicamentos: ['Dor e Febre', 'Gripe e Resfriado', 'Alergias', 'Saúde Digestiva', 'Saúde Respiratória', 'Diabetes', 'Pressão e Coração', 'Saúde da Mulher', 'Saúde do Homem', 'Outros Medicamentos']
         - Saúde e Bem-Estar: ['Vitaminas e Minerais', 'Suplementos', 'Imunidade', 'Saúde Digestiva', 'Energia e Disposição', 'Sono e Relaxamento', 'Controle de Peso', 'Esporte e Performance', 'Saúde da Mulher', 'Saúde do Homem']
         - Dermocosméticos e Beleza: ['Cuidados com o Rosto', 'Cuidados com o Corpo', 'Proteção Solar', 'Cabelos', 'Maquiagem', 'Perfumes', 'Cuidados com as Unhas', 'Beleza Masculina']
         - Higiene e Cuidados Pessoais: ['Higiene Bucal', 'Banho e Corpo', 'Desodorantes', 'Higiene Íntima', 'Cuidados Masculinos', 'Absorventes e Cuidados Femininos', 'Lenços e Algodão']
         - Mamãe e Bebê: ['Fraldas', 'Higiene do Bebê', 'Alimentação Infantil', 'Amamentação', 'Cuidados com a Mamãe']
         - Saúde, Ortopedia e Primeiros Socorros: ['Primeiros Socorros', 'Aparelhos de Saúde', 'Ortopédicos', 'Cuidados para Idosos', 'Outros Acessórios de Saúde']
         - Conveniência: ['Alimentos e Bebidas', 'Snacks', 'Produtos para o Dia a Dia', 'Acessórios', 'Utilidades']
      3. NÃO crie subcategorias avulsas. NÃO use termos genéricos como "Outros" solto ou "Geral".
      4. NÃO transforme atributos secundários (ex: miligramas '500mg', sabores, tamanhos de fraldas 'G' ou embalagens) em subcategorias.
      5. Se o produto for pet/veterinário, classifique como Conveniência (ex: 'Produtos para o Dia a Dia' ou 'Utilidades') ou Medicamentos ('Outros Medicamentos' se for remédio/tratamento veterinário).
      6. description: Descrição comercial vendedora (máx 150 chars).
      7. activePrinciple: Princípio Ativo (se aplicável).
      8. drugType: EXATAMENTE um destes valores: ['Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'].
      9. manufacturer: Fabricante/Laboratório.
      10. presentation: Apresentação (ex: 'Caixa com 30 comprimidos').
      11. indications: Indicações principais.
      
      Retorne um array de JSON em PT-BR, na mesma ordem dos produtos enviados.`,
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              activePrinciple: { type: Type.STRING },
              drugType: { type: Type.STRING, enum: ['Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'] },
              department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
              category: { type: Type.STRING },
              manufacturer: { type: Type.STRING },
              presentation: { type: Type.STRING },
              indications: { type: Type.STRING }
            }
          }
        }
      }
    }));

    if (!response.text) throw new Error("A IA retornou uma resposta vazia.");
    let jsonStr = cleanJsonResponse(response.text);
    
    let parsed: any[] = [];
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError: any) {
        // Attempt to repair truncated JSON
        const fixes = ['"]}', ']}', ']', '"}', '}', '"}', '"]', '"} ]', '"}]'];
        for (const fix of fixes) {
            try {
                const repaired = JSON.parse(jsonStr + fix);
                if (Array.isArray(repaired)) {
                    console.warn("JSON truncado foi reparado com sucesso.");
                    parsed = repaired;
                    break;
                }
            } catch (e) {
                // Continue trying fixes
            }
        }
        
        if (!parsed || parsed.length === 0) {
            try {
                const lastBraceIndex = jsonStr.lastIndexOf('}');
                if (lastBraceIndex > 0) {
                    const repaired = JSON.parse(jsonStr.substring(0, lastBraceIndex + 1) + ']');
                    if (Array.isArray(repaired)) {
                        parsed = repaired;
                    }
                }
            } catch (e) {}
        }
        if (!parsed || parsed.length === 0) throw parseError;
    }

    // Normaliza estritamente os resultados com o classificador taxonômico oficial
    return parsed.map((item, idx) => {
      const origProd = productsToEnrich[idx];
      const classified = classifyProductTaxonomy({
        name: origProd?.name || "",
        activePrinciple: item.activePrinciple,
        description: item.description,
        rawCategory: item.category,
        drugType: item.drugType,
        indications: item.indications
      });

      return {
        ...item,
        department: classified.department,
        category: classified.subcategory
      };
    });

  } catch (e: any) {
    console.error("Erro Gemini Batch Details:", e);
    if (e.message === "LIMITE_IA_ATINGIDO" || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) {
        throw e;
    }
    return productsToEnrich.map(() => ({})); // Fallback: return empty objects if batch fails
  }
};

export const fetchProductDetails = async (productName: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analise o produto farmacêutico/varejo: "${productName}". 
      1. Crie uma descrição comercial vendedora (máx 150 chars).
      2. Sugira um código interno curto (suggestedCode).
      3. Identifique o Princípio Ativo (activePrinciple).
      4. Identifique o TIPO legal do medicamento (drugType). Use EXATAMENTE um destes valores: 'Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'.
      5. Enquadre obrigatoriamente o produto em um dos 7 Departamentos Oficiais (department):
         ['Medicamentos', 'Saúde e Bem-Estar', 'Dermocosméticos e Beleza', 'Higiene e Cuidados Pessoais', 'Mamãe e Bebê', 'Saúde, Ortopedia e Primeiros Socorros', 'Conveniência']
      6. Enquadre obrigatoriamente em apenas 1 Subcategoria Oficial correspondente (category):
         - Medicamentos: ['Dor e Febre', 'Gripe e Resfriado', 'Alergias', 'Saúde Digestiva', 'Saúde Respiratória', 'Diabetes', 'Pressão e Coração', 'Saúde da Mulher', 'Saúde do Homem', 'Outros Medicamentos']
         - Saúde e Bem-Estar: ['Vitaminas e Minerais', 'Suplementos', 'Imunidade', 'Saúde Digestiva', 'Energia e Disposição', 'Sono e Relaxamento', 'Controle de Peso', 'Esporte e Performance', 'Saúde da Mulher', 'Saúde do Homem']
         - Dermocosméticos e Beleza: ['Cuidados com o Rosto', 'Cuidados com o Corpo', 'Proteção Solar', 'Cabelos', 'Maquiagem', 'Perfumes', 'Cuidados com as Unhas', 'Beleza Masculina']
         - Higiene e Cuidados Pessoais: ['Higiene Bucal', 'Banho e Corpo', 'Desodorantes', 'Higiene Íntima', 'Cuidados Masculinos', 'Absorventes e Cuidados Femininos', 'Lenços e Algodão']
         - Mamãe e Bebê: ['Fraldas', 'Higiene do Bebê', 'Alimentação Infantil', 'Amamentação', 'Cuidados com a Mamãe']
         - Saúde, Ortopedia e Primeiros Socorros: ['Primeiros Socorros', 'Aparelhos de Saúde', 'Ortopédicos', 'Cuidados para Idosos', 'Outros Acessórios de Saúde']
         - Conveniência: ['Alimentos e Bebidas', 'Snacks', 'Produtos para o Dia a Dia', 'Acessórios', 'Utilidades']
      7. Se o produto for de uso veterinário/pet, enquadre em Conveniência ('Produtos para o Dia a Dia'/'Utilidades') ou Medicamentos ('Outros Medicamentos').
      8. Preencha dados técnicos (indicações, uso, fabricante, etc).
      Retorne JSON em PT-BR.`,
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            suggestedCode: { type: Type.STRING },
            activePrinciple: { type: Type.STRING },
            drugType: { type: Type.STRING, enum: ['Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'] },
            department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
            category: { type: Type.STRING },
            manufacturer: { type: Type.STRING },
            presentation: { type: Type.STRING },
            indications: { type: Type.STRING },
            usage: { type: Type.STRING },
            sideEffects: { type: Type.STRING },
            contraindications: { type: Type.STRING }
          },
          required: ["description", "department", "category", "drugType", "suggestedCode", "activePrinciple", "indications"]
        }
      }
    }));

    if (!response.text) throw new Error("A IA retornou uma resposta vazia.");
    const jsonStr = cleanJsonResponse(response.text);
    
    let parsed: any;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (parseError: any) {
        const fixes = ['"}', '}', '"]}', ']}'];
        for (const fix of fixes) {
            try {
                parsed = JSON.parse(jsonStr + fix);
                break;
            } catch (e) {}
        }
        if (!parsed) throw parseError;
    }

    const classified = classifyProductTaxonomy({
      name: productName,
      activePrinciple: parsed.activePrinciple,
      description: parsed.description,
      rawCategory: parsed.category,
      drugType: parsed.drugType,
      indications: parsed.indications
    });

    return {
      ...parsed,
      department: classified.department,
      category: classified.subcategory
    };
  } catch (e: any) {
    console.error("Erro Gemini Details:", e);
    const msg = e.message || "";
    if (msg === "LIMITE_IA_ATINGIDO") {
        throw new Error("A cota gratuita de IA para descrições foi atingida. Tente novamente em alguns instantes.");
    }
    if (msg === "SEM_PERMISSAO_MODELO") {
        throw new Error("Sua chave de API não tem permissão para usar este modelo de IA.");
    }
    throw new Error(msg || "Erro na comunicação com a IA.");
  }
};

export const generateAiProductImage = async (productName: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Retornado para gemini-2.5-flash-image para evitar erro 403 Permission Denied
    const response = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `Professional commercial product photography of a pharmaceutical box for "${productName}", isolated on clean white background, studio lighting, high resolution, realistic style.` }],
      },
      config: {
        imageConfig: { 
            aspectRatio: "1:1"
        }
      }
    }));

    if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
    }
    throw new Error("Nenhuma imagem foi gerada.");
  } catch (e: any) {
    console.error("Erro Gemini Image Generation:", e);
    const msg = e.message || "";
    if (msg === "LIMITE_IA_ATINGIDO") {
        throw new Error("A cota gratuita para geração de imagens foi atingida hoje. Tente novamente mais tarde.");
    }
    if (msg === "SEM_PERMISSAO_MODELO") {
        throw new Error("Esta chave de API não possui permissão para gerar imagens (403). Verifique se o Google Cloud Vision/Image Generation está ativo no seu projeto.");
    }
    throw new Error("Falha ao gerar imagem: " + (msg || "Erro técnico no Google AI"));
  }
};
