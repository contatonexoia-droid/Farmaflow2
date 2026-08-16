
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

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
      contents: `Analise os seguintes produtos farmacêuticos e retorne APENAS os campos solicitados em 'missingFields' para cada um: ${JSON.stringify(productsToEnrich)}. 
      Para cada produto, retorne um objeto com os campos solicitados.
      Possíveis campos:
      1. description: Descrição comercial vendedora (máx 150 chars).
      2. activePrinciple: Princípio Ativo.
      3. drugType: TIPO legal do medicamento (EXATAMENTE um destes valores: 'Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros').
      4. category: CLASSE Terapêutica (Ex: 'Antibiótico', 'Analgésico', 'Vitamina', etc. NÃO coloque 'Genérico' aqui).
      5. manufacturer: Fabricante/Laboratório.
      6. presentation: Apresentação (ex: 'Caixa com 30 comprimidos').
      7. indications: Indicações principais.
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
    
    try {
        return JSON.parse(jsonStr);
    } catch (parseError: any) {
        // Attempt to repair truncated JSON
        const fixes = ['"]}', ']}', ']', '"}', '}', '"}', '"]', '"} ]', '"}]'];
        for (const fix of fixes) {
            try {
                const repaired = JSON.parse(jsonStr + fix);
                if (Array.isArray(repaired)) {
                    console.warn("JSON truncado foi reparado com sucesso.");
                    return repaired;
                }
            } catch (e) {
                // Continue trying fixes
            }
        }
        
        // If it still fails, try removing the last incomplete item
        try {
            const lastBraceIndex = jsonStr.lastIndexOf('}');
            if (lastBraceIndex > 0) {
                const repaired = JSON.parse(jsonStr.substring(0, lastBraceIndex + 1) + ']');
                if (Array.isArray(repaired)) {
                    console.warn("JSON truncado foi parcialmente recuperado.");
                    return repaired;
                }
            }
        } catch (e) {
            // Ignore
        }
        
        throw parseError; // Throw original error if repair fails
    }
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
      contents: `Analise o produto farmacêutico: "${productName}". 
      1. Crie uma descrição comercial vendedora (máx 150 chars).
      2. Sugira um código interno curto (suggestedCode).
      3. Identifique o Princípio Ativo (activePrinciple).
      4. Identifique o TIPO legal do medicamento (drugType). Use EXATAMENTE um destes valores: 'Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'.
      5. Identifique a CLASSE Terapêutica (category). Ex: 'Antibiótico', 'Analgésico', 'Anti-hipertensivo', 'Vitamina', etc. NÃO coloque 'Genérico' aqui.
      6. Preencha dados técnicos (indicações, uso, etc).
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
            category: { type: Type.STRING },
            manufacturer: { type: Type.STRING },
            presentation: { type: Type.STRING },
            indications: { type: Type.STRING },
            usage: { type: Type.STRING },
            sideEffects: { type: Type.STRING },
            contraindications: { type: Type.STRING }
          },
          required: ["description", "category", "drugType", "suggestedCode", "activePrinciple", "indications"]
        }
      }
    }));

    if (!response.text) throw new Error("A IA retornou uma resposta vazia.");
    const jsonStr = cleanJsonResponse(response.text);
    
    try {
        return JSON.parse(jsonStr);
    } catch (parseError: any) {
        const fixes = ['"}', '}', '"]}', ']}'];
        for (const fix of fixes) {
            try {
                return JSON.parse(jsonStr + fix);
            } catch (e) {}
        }
        throw parseError;
    }
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
