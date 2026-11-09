const sql = require('mssql');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL (Siagold):', err.message);
});

/**
 * Converte valores numéricos ou strings formatadas (ex: "19,90" ou "1.234,56") em float seguro.
 */
function parsePriceValue(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : 0;
    }
    let str = String(val).trim();
    if (!str) return 0;
    str = str.replace(/[^\d.,-]/g, '');
    if (!str) return 0;

    if (str.includes(',') && str.includes('.')) {
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }

    const parsed = parseFloat(str);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Retorna o primeiro valor de preço positivo (> 0) dentre uma lista de possíveis nomes de colunas.
 */
function pickFirstPositivePrice(record, keys) {
    if (!record || typeof record !== 'object') return 0;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            const val = parsePriceValue(record[key]);
            if (val > 0) return val;
        }
    }
    // Busca case-insensitive caso o driver SQL retorne capitalização diferente
    const lowerMap = {};
    for (const k of Object.keys(record)) {
        lowerMap[k.toLowerCase()] = record[k];
    }
    for (const key of keys) {
        const lowerKey = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(lowerMap, lowerKey)) {
            const val = parsePriceValue(lowerMap[lowerKey]);
            if (val > 0) return val;
        }
    }
    return 0;
}

/**
 * Normaliza e higieniza os preços de um registro vindo da view vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW:
 * 1. Se preco_venda / Preco_Bruto / preco vier <= 0 ou null, assume preco_original / PMC / preco_tabela.
 * 2. Se houver Preco_Liquido / preco_promocional válido (> 0 e < preço base), mapeia como promocional,
 *    evitando preços invertidos ou irreais.
 * 3. Retorna null se TODOS os campos de preço forem <= 0 (para filtrar itens sem preço algum).
 */
function normalizeAndSanitizeSiagoldRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const rawSellingPrice = pickFirstPositivePrice(raw, [
        'preco_venda',
        'Preco_Venda',
        'PRECO_VENDA',
        'Preco_Bruto',
        'preco_bruto',
        'PRECO_BRUTO',
        'PrecoVenda',
        'preco',
        'Preco',
        'PRECO',
        'price',
        'valor_venda',
        'vl_venda',
        'Pr_Venda',
        'pr_venda'
    ]);

    const rawOriginalPrice = pickFirstPositivePrice(raw, [
        'preco_original',
        'Preco_Original',
        'PRECO_ORIGINAL',
        'PMC',
        'pmc',
        'preco_pmc',
        'Preco_PMC',
        'PRECO_PMC',
        'preco_tabela',
        'Preco_Tabela',
        'PRECO_TABELA',
        'original_price',
        'Preco_Maximo',
        'preco_maximo',
        'Pr_Fabrica',
        'pr_fabrica'
    ]);

    const rawLiquidOrPromoPrice = pickFirstPositivePrice(raw, [
        'Preco_Liquido',
        'preco_liquido',
        'PRECO_LIQUIDO',
        'preco_promocional',
        'Preco_Promocional',
        'PRECO_PROMOCIONAL',
        'PrecoPromocao',
        'preco_oferta',
        'promotional_price',
        'vl_promocao',
        'Pr_Liquido',
        'pr_liquido'
    ]);

    // Regra 3: Ignorar/filtrar apenas registros onde TODOS os campos de preço sejam <= 0
    if (rawSellingPrice <= 0 && rawOriginalPrice <= 0 && rawLiquidOrPromoPrice <= 0) {
        return null;
    }

    // Regra 1: Se preco_venda / Preco_Bruto vier <= 0 ou null, preenche automaticamente com Preço Original / PMC
    // (ou Preco_Liquido caso seja o único preço positivo disponível)
    let baseSellingPrice = rawSellingPrice;
    let usedOriginalFallback = false;

    if (baseSellingPrice <= 0) {
        if (rawOriginalPrice > 0) {
            baseSellingPrice = rawOriginalPrice;
            usedOriginalFallback = true;
        } else if (rawLiquidOrPromoPrice > 0) {
            baseSellingPrice = rawLiquidOrPromoPrice;
        }
    }

    // Regra 2: Tratamento de Preco_Liquido / promocional evitando preços invertidos
    let finalOriginalPrice = rawOriginalPrice > 0 ? rawOriginalPrice : baseSellingPrice;
    let finalPromoPrice = null;

    if (rawSellingPrice > 0 && rawLiquidOrPromoPrice > rawSellingPrice) {
        // Caso invertido no ERP (Preco_Liquido maior que Preco_Bruto):
        // O maior é o preço cheio/bruto e o menor é o preço promocional/líquido
        baseSellingPrice = rawLiquidOrPromoPrice;
        finalPromoPrice = rawSellingPrice;
        if (finalOriginalPrice < baseSellingPrice) {
            finalOriginalPrice = baseSellingPrice;
        }
    } else if (rawLiquidOrPromoPrice > 0 && rawLiquidOrPromoPrice < baseSellingPrice) {
        // Preço líquido/promocional válido (> 0 e menor que o preço de venda base)
        finalPromoPrice = rawLiquidOrPromoPrice;
    }

    if (finalOriginalPrice < baseSellingPrice) {
        finalOriginalPrice = baseSellingPrice;
    }

    const normalizedPrice = Number(baseSellingPrice.toFixed(2));
    const normalizedOriginal = Number(finalOriginalPrice.toFixed(2));
    const normalizedPromo = finalPromoPrice && finalPromoPrice > 0 && finalPromoPrice < normalizedPrice
        ? Number(finalPromoPrice.toFixed(2))
        : null;

    return {
        ...raw,
        price: normalizedPrice,
        preco_venda: normalizedPrice,
        Preco_Bruto: normalizedPrice,
        original_price: normalizedOriginal,
        preco_original: normalizedOriginal,
        PMC: normalizedOriginal,
        promotional_price: normalizedPromo,
        preco_promocional: normalizedPromo,
        Preco_Liquido: normalizedPromo !== null ? normalizedPromo : normalizedPrice,
        _priceFallbackApplied: usedOriginalFallback
    };
}

class SiagoldConnector {
    constructor(dbConfig = {}) {
        this.dbConfig = {
            user: dbConfig.user || 'sa',
            password: dbConfig.password,
            server: dbConfig.server || 'localhost',
            port: Number(dbConfig.port) || 1433,
            database: dbConfig.database || 'SIAGOLD',
            connectionTimeout: 30000,
            requestTimeout: 60000,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
        this.viewName = dbConfig.viewName || 'vw_FarmaFlow_Itens';
        this.branchCode = dbConfig.branchCode || null;
    }

    async queryViewRecords(pool, viewName, lastSyncDate) {
        const hasValidLastSync =
            lastSyncDate &&
            lastSyncDate !== '1970-01-01T00:00:00.000Z' &&
            !Number.isNaN(new Date(lastSyncDate).getTime());

        // Tentativa 1: Com filtro incremental de data_ultima_alteracao (se a coluna existir na View)
        if (hasValidLastSync) {
            try {
                let query = `SELECT * FROM ${viewName} WHERE (data_ultima_alteracao IS NULL OR data_ultima_alteracao > @lastSync)`;
                const request = pool.request().input('lastSync', sql.DateTime, new Date(lastSyncDate));

                if (this.branchCode) {
                    query += ` AND codigo_filial = @branchCode`;
                    request.input('branchCode', sql.VarChar, String(this.branchCode));
                }

                query += ` ORDER BY data_ultima_alteracao ASC`;
                const result = await request.query(query);
                return result.recordset || [];
            } catch (incrementalErr) {
                // Se a view (ex: vw_FarmaFlow_Itens) não tiver data_ultima_alteracao ou codigo_filial, faz fallback para leitura completa da view
            }
        }

        // Tentativa 2: Com filtro de filial sem coluna de data
        if (this.branchCode) {
            try {
                const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                const result = await request.query(`SELECT * FROM ${viewName} WHERE codigo_filial = @branchCode`);
                return result.recordset || [];
            } catch (branchErr) {
                // Fallback para SELECT simples caso codigo_filial não exista na view
            }
        }

        // Tentativa 3: Leitura direta da View (ex: SELECT * FROM vw_FarmaFlow_Itens)
        const result = await pool.request().query(`SELECT * FROM ${viewName}`);
        return result.recordset || [];
    }

    async getChangedRecords(lastSyncDate) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);

            const candidateViews = Array.from(new Set([
                this.viewName,
                'vw_FarmaFlow_Itens',
                'VW_INTEGRACAO_FARMAFLOW'
            ].filter(Boolean)));

            let rawRecords = [];
            let lastQueryError = null;
            let usedView = this.viewName;

            for (const candidateView of candidateViews) {
                try {
                    rawRecords = await this.queryViewRecords(pool, candidateView, lastSyncDate);
                    usedView = candidateView;
                    lastQueryError = null;
                    break;
                } catch (err) {
                    lastQueryError = err;
                }
            }

            if (lastQueryError && rawRecords.length === 0) {
                throw lastQueryError;
            }

            let fallbackCount = 0;
            let skippedZeroPriceCount = 0;
            const sanitizedRecords = [];

            for (const row of rawRecords) {
                const normalized = normalizeAndSanitizeSiagoldRecord(row);
                if (!normalized) {
                    skippedZeroPriceCount++;
                    continue;
                }
                if (normalized._priceFallbackApplied) {
                    fallbackCount++;
                }
                delete normalized._priceFallbackApplied;
                sanitizedRecords.push(normalized);
            }

            console.log(
                `[Siagold] View "${usedView}": ${rawRecords.length} lidos | ` +
                `${sanitizedRecords.length} válidos | ` +
                `${fallbackCount} com preço corrigido via Preço Original/PMC | ` +
                `${skippedZeroPriceCount} ignorados (todos os preços <= 0).`
            );

            return sanitizedRecords;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (err) {
                    console.error('Erro ao fechar conexão com o banco (Siagold):', err.message);
                }
            }
        }
    }
}

SiagoldConnector.normalizeAndSanitizeSiagoldRecord = normalizeAndSanitizeSiagoldRecord;
SiagoldConnector.parsePriceValue = parsePriceValue;

module.exports = SiagoldConnector;
