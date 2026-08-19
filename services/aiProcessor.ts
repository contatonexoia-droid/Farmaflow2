import { Product } from '../types';
import { fetchProductDetailsBatch } from './gemini.js';
import { getAiEnrichedProductsCache, updateProductAiFields } from './storage.js';

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
    const batchSize = 10;

    // Load local knowledge base (cache)
    const cacheData = await getAiEnrichedProductsCache();
    const cacheMap = new Map<string, Partial<Product>>();
    
    cacheData.forEach(p => {
        if (p.barcode) cacheMap.set(`ean:${p.barcode}`, p);
        if (p.name) cacheMap.set(`name:${p.name.toLowerCase().trim()}`, p);
    });

    for (let i = 0; i < total; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        
        // Check cache first
        const toFetchFromAi: Product[] = [];
        const cachedUpdates: Product[] = [];
        
        batch.forEach(product => {
            const cachedByEan = product.barcode ? cacheMap.get(`ean:${product.barcode}`) : null;
            const cachedByName = cacheMap.get(`name:${product.name.toLowerCase().trim()}`);
            
            const cached = cachedByEan || cachedByName;
            
            if (cached) {
                cachedUpdates.push({
                    ...product,
                    ...cached,
                    activePrinciple: cached.activePrinciple || product.activePrinciple,
                    drugType: cached.drugType || product.drugType,
                    presentation: cached.presentation || product.presentation,
                    description: cached.description || product.description,
                    indications: cached.indications || product.indications,
                    category: cached.category || product.category,
                    manufacturer: cached.manufacturer || product.manufacturer,
                    isAiEnriched: true
                });
            } else {
                toFetchFromAi.push(product);
            }
        });

        // Apply cached updates immediately
        if (cachedUpdates.length > 0) {
            await updateProductAiFields(cachedUpdates);
            await onProductsUpdated(cachedUpdates);
            report.processed += cachedUpdates.length;
        }

        // Fetch remaining from AI
        if (toFetchFromAi.length > 0) {
            const productsToEnrich = toFetchFromAi.map(p => {
                const missingFields = [];
                if (!p.description || p.description.length < 10) missingFields.push('description');
                if (!p.activePrinciple || p.activePrinciple.length < 3) missingFields.push('activePrinciple');
                if (!p.drugType) missingFields.push('drugType');
                if (!p.category || p.category === 'Geral') missingFields.push('category');
                if (!p.manufacturer) missingFields.push('manufacturer');
                if (!p.presentation) missingFields.push('presentation');
                if (!p.indications) missingFields.push('indications');
                
                // Estimate tokens saved (roughly 50 tokens per field not requested)
                const totalFields = 7;
                report.tokensSaved += (totalFields - missingFields.length) * 50;

                return {
                    name: p.name,
                    missingFields
                };
            });
            
            try {
                const enrichedDataList = await fetchProductDetailsBatch(productsToEnrich);
                
                const updatedProducts = toFetchFromAi.map((product, index) => {
                    const enrichedData = enrichedDataList[index] || {};
                    
                    if (Object.keys(enrichedData).length > 0) {
                        return {
                            ...product,
                            ...enrichedData,
                            activePrinciple: enrichedData.activePrinciple || product.activePrinciple,
                            drugType: enrichedData.drugType || product.drugType,
                            presentation: enrichedData.presentation || product.presentation,
                            description: enrichedData.description || product.description,
                            indications: enrichedData.indications || product.indications,
                            category: enrichedData.category || product.category,
                            manufacturer: enrichedData.manufacturer || product.manufacturer,
                            isAiEnriched: true
                        };
                    }
                    return product;
                });
                
                const actuallyUpdated = updatedProducts.filter((p, idx) => Object.keys(enrichedDataList[idx] || {}).length > 0);
                
                if (actuallyUpdated.length > 0) {
                    await updateProductAiFields(actuallyUpdated);
                    await onProductsUpdated(actuallyUpdated);
                    report.processed += actuallyUpdated.length;
                    
                    // Add to local cache map for subsequent batches
                    actuallyUpdated.forEach(p => {
                        if (p.barcode) cacheMap.set(`ean:${p.barcode}`, p);
                        cacheMap.set(`name:${p.name.toLowerCase().trim()}`, p);
                    });
                }
                report.failed += toFetchFromAi.length - actuallyUpdated.length;

            } catch (e: any) {
                console.error("Batch enrichment failed", e);
                report.failed += toFetchFromAi.length;
                if (e.message === "LIMITE_IA_ATINGIDO" || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) {
                    console.warn("Gemini API rate limit hit. Stopping AI enrichment queue.");
                    break;
                }
            }
            
            // Small delay between AI batches to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        onProgress(Math.min(i + batchSize, total), total, report);
    }
    
    return report;
};
