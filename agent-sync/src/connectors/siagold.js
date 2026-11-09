const sql = require('mssql');
const {
    parsePriceValue,
    parseStockValue,
    parseActiveStatus,
    getFieldIgnoreCase,
    extractBarcode,
    extractInternalCode,
    normalizeAndSanitizeSiagoldRecord
} = require('../shared/priceNormalizer');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL (Siagold):', err.message);
});

function resolveRecordIdentityKey(record) {
    if (!record || typeof record !== 'object') return null;
    if (record.internal_code && String(record.internal_code).trim()) {
        return String(record.internal_code).trim();
    }
    if (record.barcode && String(record.barcode).trim()) {
        return String(record.barcode).trim();
    }
    const bc = extractBarcode(record);
    const code = extractInternalCode(record, bc);
    return code || bc || null;
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
        this.knownActiveProductKeys = new Set();
    }

    async queryViewRecords(pool, viewName, lastSyncDate) {
        const hasValidLastSync = Boolean(
            lastSyncDate &&
            lastSyncDate !== '1970-01-01T00:00:00.000Z' &&
            !Number.isNaN(new Date(lastSyncDate).getTime())
        );

        // Tentativa 1: Sincronização Incremental via data_ultima_alteracao (se a coluna existir na View)
        if (hasValidLastSync) {
            try {
                let query = `SELECT * FROM ${viewName} WHERE data_ultima_alteracao > @lastSync`;
                const request = pool.request().input('lastSync', sql.DateTime, new Date(lastSyncDate));

                if (this.branchCode) {
                    query += ` AND codigo_filial = @branchCode`;
                    request.input('branchCode', sql.VarChar, String(this.branchCode));
                }

                query += ` ORDER BY data_ultima_alteracao ASC`;
                const result = await request.query(query);
                return {
                    records: result.recordset || [],
                    isIncrementalQuery: true
                };
            } catch (incrementalErr) {
                // Fallback para leitura completa caso a view não possua data_ultima_alteracao
            }
        }

        // Tentativa 2: Com filtro de filial sem coluna de data
        if (this.branchCode) {
            try {
                const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                const result = await request.query(`SELECT * FROM ${viewName} WHERE codigo_filial = @branchCode`);
                return {
                    records: result.recordset || [],
                    isIncrementalQuery: false
                };
            } catch (branchErr) {}
        }

        // Tentativa 3: Leitura direta da View (ex: SELECT * FROM vw_FarmaFlow_Itens)
        const result = await pool.request().query(`SELECT * FROM ${viewName}`);
        return {
            records: result.recordset || [],
            isIncrementalQuery: false
        };
    }

    async getChangedRecords(lastSyncDate) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);

            const hasValidLastSync = Boolean(
                lastSyncDate &&
                lastSyncDate !== '1970-01-01T00:00:00.000Z' &&
                !Number.isNaN(new Date(lastSyncDate).getTime())
            );

            const candidateViews = Array.from(new Set([
                this.viewName,
                'vw_FarmaFlow_Itens',
                'VW_INTEGRACAO_FARMAFLOW'
            ].filter(Boolean)));

            let rawRecords = [];
            let isIncrementalQuery = false;
            let lastQueryError = null;
            let usedView = this.viewName;

            for (const candidateView of candidateViews) {
                try {
                    const queryResult = await this.queryViewRecords(pool, candidateView, lastSyncDate);
                    rawRecords = queryResult.records;
                    isIncrementalQuery = queryResult.isIncrementalQuery;
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

            // Log de Diagnóstico das Colunas e do primeiro registro bruto da View
            if (rawRecords.length > 0 && rawRecords[0]) {
                console.log(`[Siagold] Colunas detectadas na View: ${Object.keys(rawRecords[0]).join(', ')}`);
                console.log(`[Siagold] Valores brutos do 1º item:`, JSON.stringify(rawRecords[0]));
            }

            let fallbackCount = 0;
            let skippedZeroPriceCount = 0;
            let skippedZeroStockOrInactiveCount = 0;
            let zeroStockUpdatesAllowed = 0;
            const sanitizedRecords = [];

            for (const row of rawRecords) {
                const normalized = normalizeAndSanitizeSiagoldRecord(row);
                if (!normalized) {
                    skippedZeroPriceCount++;
                    continue;
                }

                const identityKey = resolveRecordIdentityKey(normalized);
                const hasPositiveStock = normalized.stock > 0 && normalized.active !== false;

                if (!hasPositiveStock) {
                    const canSendStockOut =
                        hasValidLastSync &&
                        (isIncrementalQuery || (identityKey && this.knownActiveProductKeys.has(identityKey)));

                    if (!canSendStockOut) {
                        skippedZeroStockOrInactiveCount++;
                        continue;
                    }

                    zeroStockUpdatesAllowed++;
                    if (identityKey) {
                        this.knownActiveProductKeys.delete(identityKey);
                    }
                } else if (identityKey) {
                    this.knownActiveProductKeys.add(identityKey);
                }

                if (normalized._priceFallbackApplied) {
                    fallbackCount++;
                }
                delete normalized._priceFallbackApplied;
                sanitizedRecords.push(normalized);
            }

            console.log(
                `[Siagold] ${rawRecords.length} lidos | ` +
                `${sanitizedRecords.length} válidos (estoque > 0${zeroStockUpdatesAllowed > 0 ? ` + ${zeroStockUpdatesAllowed} baixas p/ 0` : ''}) | ` +
                `${skippedZeroStockOrInactiveCount} ignorados por estoque zerado/inativo` +
                (fallbackCount > 0 ? ` | ${fallbackCount} corrigidos via PMC` : '') +
                (skippedZeroPriceCount > 0 ? ` | ${skippedZeroPriceCount} sem preço` : '') +
                ` [View: ${usedView}]`
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
SiagoldConnector.parseStockValue = parseStockValue;
SiagoldConnector.parseActiveStatus = parseActiveStatus;
SiagoldConnector.extractBarcode = extractBarcode;
SiagoldConnector.extractInternalCode = extractInternalCode;

module.exports = SiagoldConnector;
