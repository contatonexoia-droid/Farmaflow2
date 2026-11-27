import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { OFFICIAL_DEPARTMENTS, classifyProductTaxonomy } from "../lib/departments.js";

const DEFAULT_ENRICH_MODEL = "gemini-2.5-flash";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ProductAiEnrichInput {
  name: string;
  barcode?: string;
  manufacturer?: string;
  category?: string;
  presentation?: string;
  activePrinciple?: string;
}

export interface ProductAiEnrichResult {
  description: string;
  suggestedCode: string;
  activePrinciple: string;
  drugType: string;
  department: string;
  category: string;
  manufacturer: string;
  presentation: string;
  indications: string;
  usage: string;
  sideEffects: string;
  contraindications: string;
}

export interface ProductAiBatchInput {
  name: string;
  missingFields?: string[];
  barcode?: string;
  manufacturer?: string;
  category?: string;
  presentation?: string;
}

function createProductAiError(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function getServerGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw createProductAiError(
      "Chave GEMINI_API_KEY não configurada no servidor. Configure a variável de ambiente no painel do servidor.",
      503
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2,
  delay = 1000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error?.status || error?.code;
    const message = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));

    if (status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      if (message.includes("limit: 0") || message.toLowerCase().includes("quota")) {
        throw createProductAiError(
          "A cota da IA para enriquecimento de produtos foi atingida temporariamente. Tente novamente em alguns instantes.",
          429
        );
      }
      if (retries > 0) {
        await wait(delay);
        return retryWithBackoff(fn, retries - 1, delay * factor, factor);
      }
      throw createProductAiError(
        "Muitas solicitações simultâneas à IA. Aguarde alguns segundos e tente novamente.",
        429
      );
    }

    if (status === 403 || message.includes("403") || message.includes("PERMISSION_DENIED") || message.includes("API_KEY_SERVICE_BLOCKED")) {
      throw createProductAiError(
        "A chave de API do servidor não possui permissão para utilizar este modelo de IA.",
        403
      );
    }

    if (status === 401 || message.includes("401") || message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      throw createProductAiError(
        "A chave GEMINI_API_KEY configurada no servidor é inválida.",
        502
      );
    }

    if (retries > 0) {
      await wait(delay);
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

function sanitizeTextHint(val: unknown, maxLen = 200): string {
  if (typeof val !== "string") return "";
  return val.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLen);
}

function mapGeminiException(err: any, fallbackMessage: string): Error & { statusCode: number } {
  if (err?.statusCode) return err;
  const msg = String(err?.message || "");
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota")) {
    return createProductAiError(
      "A cota da IA foi atingida temporariamente. Tente novamente em alguns instantes.",
      429
    );
  }
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
    return createProductAiError(
      "A chave de API do servidor não tem permissão para usar este modelo de IA.",
      403
    );
  }
  if (msg.includes("401") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
    return createProductAiError(
      "A chave GEMINI_API_KEY configurada no servidor é inválida.",
      502
    );
  }
  return createProductAiError(fallbackMessage, 500);
}

export async function enrichProductWithAi(input: ProductAiEnrichInput): Promise<ProductAiEnrichResult> {
  const cleanName = sanitizeTextHint(input.name, 240);
  if (!cleanName || cleanName.length < 2) {
    throw createProductAiError("Informe o nome do produto para gerar os dados com IA.", 400);
  }

  const cleanBarcode = sanitizeTextHint(input.barcode, 40);
  const cleanManufacturer = sanitizeTextHint(input.manufacturer, 120);
  const cleanCategory = sanitizeTextHint(input.category, 120);
  const cleanPresentation = sanitizeTextHint(input.presentation, 140);
  const cleanActivePrinciple = sanitizeTextHint(input.activePrinciple, 140);

  const hints: string[] = [`Nome do Produto: "${cleanName}"`];
  if (cleanBarcode) hints.push(`Código de Barras (EAN): "${cleanBarcode}"`);
  if (cleanManufacturer) hints.push(`Fabricante informado: "${cleanManufacturer}"`);
  if (cleanCategory) hints.push(`Categoria atual: "${cleanCategory}"`);
  if (cleanPresentation) hints.push(`Apresentação informada: "${cleanPresentation}"`);
  if (cleanActivePrinciple) hints.push(`Princípio ativo informado: "${cleanActivePrinciple}"`);

  const ai = getServerGeminiClient();

  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_ENRICH_MODEL,
        contents: `Analise o produto farmacêutico/varejo abaixo e preencha todos os campos solicitados em PT-BR:
${hints.join("\n")}

Regras obrigatórias:
1. description: Crie uma descrição comercial clara e vendedora (máx 150 chars).
2. suggestedCode: Sugira um código interno curto e padronizado.
3. activePrinciple: Identifique o Princípio Ativo (ou informe o principal composto/categoria caso não seja medicamento).
4. drugType: Identifique o TIPO legal do produto usando EXATAMENTE um destes valores: 'Genérico', 'Referência', 'Similar', 'Fitoterápico', 'Cosmético', 'Outros'.
5. department: Enquadre obrigatoriamente em um dos 7 Departamentos Oficiais:
   ['Medicamentos', 'Saúde e Bem-Estar', 'Dermocosméticos e Beleza', 'Higiene e Cuidados Pessoais', 'Mamãe e Bebê', 'Saúde, Ortopedia e Primeiros Socorros', 'Conveniência']
6. category: Enquadre obrigatoriamente em apenas 1 Subcategoria Oficial correspondente:
   - Medicamentos: ['Dor e Febre', 'Gripe e Resfriado', 'Alergias', 'Saúde Digestiva', 'Saúde Respiratória', 'Diabetes', 'Pressão e Coração', 'Saúde da Mulher', 'Saúde do Homem', 'Outros Medicamentos']
   - Saúde e Bem-Estar: ['Vitaminas e Minerais', 'Suplementos', 'Imunidade', 'Saúde Digestiva', 'Energia e Disposição', 'Sono e Relaxamento', 'Controle de Peso', 'Esporte e Performance', 'Saúde da Mulher', 'Saúde do Homem']
   - Dermocosméticos e Beleza: ['Cuidados com o Rosto', 'Cuidados com o Corpo', 'Proteção Solar', 'Cabelos', 'Maquiagem', 'Perfumes', 'Cuidados com as Unhas', 'Beleza Masculina']
   - Higiene e Cuidados Pessoais: ['Higiene Bucal', 'Banho e Corpo', 'Desodorantes', 'Higiene Íntima', 'Cuidados Masculinos', 'Absorventes e Cuidados Femininos', 'Lenços e Algodão']
   - Mamãe e Bebê: ['Fraldas', 'Higiene do Bebê', 'Alimentação Infantil', 'Amamentação', 'Cuidados com a Mamãe']
   - Saúde, Ortopedia e Primeiros Socorros: ['Primeiros Socorros', 'Aparelhos de Saúde', 'Ortopédicos', 'Cuidados para Idosos', 'Outros Acessórios de Saúde']
   - Conveniência: ['Alimentos e Bebidas', 'Snacks', 'Produtos para o Dia a Dia', 'Acessórios', 'Utilidades']
7. Se o produto for de uso veterinário/pet, enquadre em Conveniência ('Produtos para o Dia a Dia'/'Utilidades') ou Medicamentos ('Outros Medicamentos').
8. Preencha também manufacturer, presentation, indications, usage, sideEffects e contraindications em PT-BR de forma objetiva e responsável.
Retorne apenas JSON válido.`,
        config: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              suggestedCode: { type: Type.STRING },
              activePrinciple: { type: Type.STRING },
              drugType: {
                type: Type.STRING,
                enum: ["Genérico", "Referência", "Similar", "Fitoterápico", "Cosmético", "Outros"],
              },
              department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
              category: { type: Type.STRING },
              manufacturer: { type: Type.STRING },
              presentation: { type: Type.STRING },
              indications: { type: Type.STRING },
              usage: { type: Type.STRING },
              sideEffects: { type: Type.STRING },
              contraindications: { type: Type.STRING },
            },
            required: [
              "description",
              "department",
              "category",
              "drugType",
              "suggestedCode",
              "activePrinciple",
              "indications",
            ],
          },
        },
      })
    );

    if (!response.text) {
      throw createProductAiError("A IA retornou uma resposta vazia. Tente novamente.", 502);
    }

    const jsonStr = cleanJsonResponse(response.text);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      const fixes = ['"}', "}", '"]}', "]}"];
      for (const fix of fixes) {
        try {
          parsed = JSON.parse(jsonStr + fix);
          break;
        } catch (_) {}
      }
      if (!parsed) throw parseError;
    }

    const classified = classifyProductTaxonomy({
      name: cleanName,
      activePrinciple: parsed.activePrinciple || cleanActivePrinciple,
      description: parsed.description,
      rawCategory: parsed.category || cleanCategory,
      drugType: parsed.drugType,
      indications: parsed.indications,
      manufacturer: parsed.manufacturer || cleanManufacturer,
    });

    return {
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      suggestedCode: typeof parsed.suggestedCode === "string" ? parsed.suggestedCode.trim() : "",
      activePrinciple:
        typeof parsed.activePrinciple === "string" && parsed.activePrinciple.trim()
          ? parsed.activePrinciple.trim()
          : cleanActivePrinciple,
      drugType: typeof parsed.drugType === "string" && parsed.drugType.trim() ? parsed.drugType.trim() : "Outros",
      department: classified.department,
      category: classified.subcategory,
      manufacturer:
        typeof parsed.manufacturer === "string" && parsed.manufacturer.trim()
          ? parsed.manufacturer.trim()
          : cleanManufacturer,
      presentation:
        typeof parsed.presentation === "string" && parsed.presentation.trim()
          ? parsed.presentation.trim()
          : cleanPresentation,
      indications: typeof parsed.indications === "string" ? parsed.indications.trim() : "",
      usage: typeof parsed.usage === "string" ? parsed.usage.trim() : "",
      sideEffects: typeof parsed.sideEffects === "string" ? parsed.sideEffects.trim() : "",
      contraindications: typeof parsed.contraindications === "string" ? parsed.contraindications.trim() : "",
    };
  } catch (err: any) {
    console.error("[ProductAiService enrichProductWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível gerar os detalhes do produto com a IA no momento.");
  }
}

export async function enrichProductsBatchWithAi(productsToEnrich: ProductAiBatchInput[]): Promise<Record<string, any>[]> {
  if (!Array.isArray(productsToEnrich) || productsToEnrich.length === 0) {
    return [];
  }

  const sanitizedBatch = productsToEnrich.slice(0, 25).map((item) => ({
    name: sanitizeTextHint(item?.name, 220),
    missingFields: Array.isArray(item?.missingFields)
      ? item.missingFields.map((f) => sanitizeTextHint(f, 40)).filter(Boolean)
      : ["description", "activePrinciple", "drugType", "category", "manufacturer", "presentation", "indications"],
    ...(item?.barcode ? { barcode: sanitizeTextHint(item.barcode, 40) } : {}),
    ...(item?.manufacturer ? { manufacturer: sanitizeTextHint(item.manufacturer, 100) } : {}),
    ...(item?.category ? { category: sanitizeTextHint(item.category, 100) } : {}),
    ...(item?.presentation ? { presentation: sanitizeTextHint(item.presentation, 120) } : {}),
  }));

  const ai = getServerGeminiClient();

  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_ENRICH_MODEL,
        contents: `Analise os seguintes produtos farmacêuticos/varejo e retorne APENAS os campos solicitados em 'missingFields' para cada um: ${JSON.stringify(sanitizedBatch)}.
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
5. Se o produto for pet/veterinário, classifique como Conveniência ('Produtos para o Dia a Dia' ou 'Utilidades') ou Medicamentos ('Outros Medicamentos').
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
                drugType: {
                  type: Type.STRING,
                  enum: ["Genérico", "Referência", "Similar", "Fitoterápico", "Cosmético", "Outros"],
                },
                department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
                category: { type: Type.STRING },
                manufacturer: { type: Type.STRING },
                presentation: { type: Type.STRING },
                indications: { type: Type.STRING },
              },
            },
          },
        },
      })
    );

    if (!response.text) {
      throw createProductAiError("A IA retornou uma resposta vazia.", 502);
    }

    const jsonStr = cleanJsonResponse(response.text);
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      const fixes = ['"]}', "]}", "]", '"}', "}", '"]', '"} ]', '"}]'];
      for (const fix of fixes) {
        try {
          const repaired = JSON.parse(jsonStr + fix);
          if (Array.isArray(repaired)) {
            parsed = repaired;
            break;
          }
        } catch (_) {}
      }
      if (!parsed || parsed.length === 0) {
        try {
          const lastBraceIndex = jsonStr.lastIndexOf("}");
          if (lastBraceIndex > 0) {
            const repaired = JSON.parse(jsonStr.substring(0, lastBraceIndex + 1) + "]");
            if (Array.isArray(repaired)) {
              parsed = repaired;
            }
          }
        } catch (_) {}
      }
      if (!parsed || parsed.length === 0) throw parseError;
    }

    return sanitizedBatch.map((origProd, idx) => {
      const item = parsed[idx] || {};
      const classified = classifyProductTaxonomy({
        name: origProd.name || "",
        activePrinciple: item.activePrinciple,
        description: item.description,
        rawCategory: item.category || origProd.category,
        drugType: item.drugType,
        indications: item.indications,
        manufacturer: item.manufacturer || origProd.manufacturer,
      });

      return {
        ...item,
        department: classified.department,
        category: classified.subcategory,
      };
    });
  } catch (err: any) {
    console.error("[ProductAiService enrichProductsBatchWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível enriquecer o lote de produtos com a IA.");
  }
}

export async function generateProductImageWithAi(productName: string): Promise<{ image: string }> {
  const cleanName = sanitizeTextHint(productName, 240);
  if (!cleanName || cleanName.length < 2) {
    throw createProductAiError("Informe o nome do produto para gerar a imagem com IA.", 400);
  }

  const ai = getServerGeminiClient();

  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_IMAGE_MODEL,
        contents: {
          parts: [
            {
              text: `Professional commercial product photography of a pharmaceutical box for "${cleanName}", isolated on clean white background, studio lighting, high resolution, realistic style.`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      })
    );

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          return { image: `data:${mimeType};base64,${part.inlineData.data}` };
        }
      }
    }

    throw createProductAiError("Nenhuma imagem foi gerada para este produto.", 502);
  } catch (err: any) {
    console.error("[ProductAiService generateProductImageWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível gerar a imagem do produto com a IA no momento.");
  }
}
