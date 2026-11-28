import { Product } from "../types";
import { fetchProductDetailsBatch } from "./gemini.js";
import { getAiEnrichedProductsCache, updateProductAiFields } from "./storage.js";
import { getMissingEnrichableFields, isEnrichableFieldEmpty } from "../utils/productCompleteness.js";

export interface AiEnrichmentReport {
  processed: number;
  failed: number;
  tokensSaved: number;
}

export const processAiEnrichmentQueue = async (
  products: Product[],
  onProgress: (processed: number, total: number, report: AiEnrichmentReport) => void,
  onProductsUpdated: (products: Product[]) => void
) => {
  const report: AiEnrichmentReport = { processed: 0, failed: 0, tokensSaved: 0 };
  const total = products.length;
  const batchSize = 5;

  const cacheData = await getAiEnrichedProductsCache();
  const cacheMap = new Map<string, Partial<Product>>();

  cacheData.forEach((p) => {
    if (p.barcode) cacheMap.set(`ean:${p.barcode}`, p);
    if (p.name) cacheMap.set(`name:${p.name.toLowerCase().trim()}`, p);
  });

  for (let i = 0; i < total; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    const toFetchFromAi: Product[] = [];
    const cachedUpdates: Product[] = [];

    batch.forEach((product) => {
      const cachedByEan = product.barcode ? cacheMap.get(`ean:${product.barcode}`) : null;
      const cachedByName = cacheMap.get(`name:${product.name.toLowerCase().trim()}`);
      const cached = cachedByEan || cachedByName;

      // Só reaproveita cache local se realmente cobrir os campos faltantes (inclusive `usage`)
      const missingNow = getMissingEnrichableFields(product);
      const cacheCoversAll =
        Boolean(cached) &&
        missingNow.every((field) => !isEnrichableFieldEmpty(cached as any, field));

      if (cached && cacheCoversAll) {
        cachedUpdates.push({
          ...product,
          activePrinciple: !isEnrichableFieldEmpty(product, "activePrinciple")
            ? product.activePrinciple
            : cached.activePrinciple || product.activePrinciple,
          drugType: product.drugType || cached.drugType,
          presentation: !isEnrichableFieldEmpty(product, "presentation")
            ? product.presentation
            : cached.presentation || product.presentation,
          description: !isEnrichableFieldEmpty(product, "description")
            ? product.description
            : cached.description || product.description,
          indications: !isEnrichableFieldEmpty(product, "indications")
            ? product.indications
            : cached.indications || product.indications,
          usage: !isEnrichableFieldEmpty(product, "usage")
            ? product.usage
            : cached.usage || product.usage,
          category:
            product.category && product.category !== "Geral"
              ? product.category
              : cached.category || product.category,
          manufacturer:
            product.manufacturer && product.manufacturer !== "Outros"
              ? product.manufacturer
              : cached.manufacturer || product.manufacturer,
          requires_prescription: Boolean(
            product.requires_prescription || cached.requires_prescription
          ),
          isAiEnriched: true,
        });
        report.tokensSaved += 250;
      } else {
        toFetchFromAi.push(product);
      }
    });

    if (cachedUpdates.length > 0) {
      await updateProductAiFields(cachedUpdates);
      await onProductsUpdated(cachedUpdates);
      report.processed += cachedUpdates.length;
    }

    if (toFetchFromAi.length > 0) {
      const productsToEnrich = toFetchFromAi.map((p) => {
        const missingFields = getMissingEnrichableFields(p);
        report.tokensSaved += Math.max(0, 5 - missingFields.length) * 50;

        return {
          id: p.id,
          name: p.name,
          missingFields,
          ...(p.barcode ? { barcode: p.barcode } : {}),
          ...(p.manufacturer ? { manufacturer: p.manufacturer } : {}),
          ...(p.category ? { category: p.category } : {}),
          ...(p.presentation ? { presentation: p.presentation } : {}),
          ...(p.activePrinciple ? { activePrinciple: p.activePrinciple } : {}),
          ...(p.drugType ? { drugType: p.drugType } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.indications ? { indications: p.indications } : {}),
          ...(p.usage ? { usage: p.usage } : {}),
          requires_prescription: Boolean(p.requires_prescription),
        };
      });

      try {
        const batchTenantId =
          (toFetchFromAi[0] as any)?.tenant_id || (toFetchFromAi[0] as any)?.tenantId;
        const enrichedDataList = await fetchProductDetailsBatch(productsToEnrich, batchTenantId);

        const actuallyUpdated: Product[] = [];

        toFetchFromAi.forEach((product, index) => {
          const enrichedData = enrichedDataList[index] || {};
          const hasValidUpdate =
            Object.keys(enrichedData).length > 0 && enrichedData.confidence !== "low";

          if (!hasValidUpdate) {
            report.failed += 1;
            return;
          }

          actuallyUpdated.push({
            ...product,
            activePrinciple: enrichedData.activePrinciple || product.activePrinciple,
            drugType: enrichedData.drugType || product.drugType,
            presentation: enrichedData.presentation || product.presentation,
            description: enrichedData.description || product.description,
            indications: enrichedData.indications || product.indications,
            usage: enrichedData.usage || product.usage,
            category:
              product.category && product.category !== "Geral"
                ? product.category
                : enrichedData.category || product.category,
            manufacturer:
              product.manufacturer && product.manufacturer !== "Outros"
                ? product.manufacturer
                : enrichedData.manufacturer || product.manufacturer,
            requires_prescription: Boolean(
              product.requires_prescription || enrichedData.requires_prescription
            ),
            isAiEnriched: true,
          });
        });

        if (actuallyUpdated.length > 0) {
          await updateProductAiFields(actuallyUpdated);
          await onProductsUpdated(actuallyUpdated);
          report.processed += actuallyUpdated.length;

          actuallyUpdated.forEach((p) => {
            if (p.barcode) cacheMap.set(`ean:${p.barcode}`, p);
            cacheMap.set(`name:${p.name.toLowerCase().trim()}`, p);
          });
        }
      } catch (e: any) {
        console.error("Batch enrichment failed", e);
        report.failed += toFetchFromAi.length;
        if (
          e.message === "LIMITE_IA_ATINGIDO" ||
          e.message?.includes("429") ||
          e.message?.includes("RESOURCE_EXHAUSTED")
        ) {
          console.warn("Gemini API rate limit hit. Stopping AI enrichment queue.");
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    onProgress(Math.min(i + batchSize, total), total, report);
  }

  return report;
};
