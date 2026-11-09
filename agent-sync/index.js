process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
try {
    require('dotenv').config();
} catch (e) {}

const sql = require('mssql');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const {
    parsePriceValue,
    parseStockValue,
    parseActiveStatus,
    getFieldIgnoreCase,
    normalizeAndSanitizeSiagoldRecord
} = require('./src/shared/priceNormalizer');

const BATCH_SIZE = 200;
const BATCH_DELAY_MS = 500;
const MAX_BATCH_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60000; // 60 segundos por lote

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items, size = BATCH_SIZE) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

// Configuração HTTPS resiliente com TLS 1.2/1.3
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    keepAlive: true,
    keepAliveMsecs: 30000,
    ciphers: [
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'ECDHE-RSA-AES128-SHA',
        'ECDHE-RSA-AES256-SHA',
        'AES128-GCM-SHA256',
        'AES256-GCM-SHA384',
        'AES128-SHA',
        'AES256-SHA',
        'DEFAULT:@SECLEVEL=1'
    ].join(':'),
    honorCipherOrder: true
});

const apiClient = axios.create({
    httpsAgent,
    httpAgent: new http.Agent({ keepAlive: true, keepAliveMsecs: 30000 }),
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

function sanitizeUrl(raw) {
    let url = (raw || 'https://farmaflow.online/api/v1/integration').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    url = url.replace(/farmaflow\.nexoia\.online/gi, 'farmaflow.online');
    url = url.replace(/farmaflow\.online\.nexoia\.online/gi, 'farmaflow.online');
    url = url.replace(/nexoia\.online\.farmaflow\.online/gi, 'farmaflow.online');
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/integration')) {
        if (!url.includes('/api/')) {
            url = `${url}/api/v1/integration`;
        } else {
            url = `${url}/integration`;
        }
    }
    return url;
}

const API_URL = sanitizeUrl(process.env.API_URL || process.env.API_BASE_URL);
const API_KEY = process.env.API_KEY || '02ebf5a7-ccec-47e1-99ae-4e00729b4df1';
const VIEW_NAME = process.env.DB_VIEW || 'vw_FarmaFlow_Itens';
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS, 10) || 60000;
const RETRY_INTERVAL_MS = parseInt(process.env.RETRY_INTERVAL_MS, 10) || 300000;

const dbConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_NAME || 'SIAGOLD',
    connectionTimeout: 30000,
    requestTimeout: 60000,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

const STATE_FILE = path.join(process.cwd(), 'sync_state.json');
const knownActiveProductKeys = new Set();

function getLastSyncDate() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const state = JSON.parse(data);
            return state.lastSyncDate || '1970-01-01T00:00:00.000Z';
        }
    } catch (error) {
        console.error('Erro ao ler arquivo de estado:', error.message);
    }
    return '1970-01-01T00:00:00.000Z';
}

function saveLastSyncDate(dateStr) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSyncDate: dateStr }, null, 2));
    } catch (error) {
        console.error('Erro ao salvar arquivo de estado:', error.message);
    }
}

function resolveRecordIdentityKey(record) {
    const code = getFieldIgnoreCase(record, [
        'codigo', 'cod_produto', 'CodigoProduto', 'CODIGO', 'ID_PRODUTO', 'id', 'internal_code', 'SKU', 'sku'
    ]);
    const ean = getFieldIgnoreCase(record, [
        'codigo_barras', 'EAN', 'ean', 'gtin', 'CodigoBarras', 'COD_BARRAS', 'BARRAS', 'barcode'
    ]);
    const cleanCode = code !== undefined && code !== null ? String(code).trim() : '';
    const cleanEan = ean !== undefined && ean !== null ? String(ean).trim() : '';
    return cleanCode || cleanEan || null;
}

async function fetchRecordsFromView(pool, lastSync) {
    const candidateViews = Array.from(new Set([
        VIEW_NAME,
        'vw_FarmaFlow_Itens',
        'VW_INTEGRACAO_FARMAFLOW'
    ]));

    const hasValidLastSync = Boolean(
        lastSync &&
        lastSync !== '1970-01-01T00:00:00.000Z' &&
        !Number.isNaN(new Date(lastSync).getTime())
    );

    let lastErr = null;
    for (const view of candidateViews) {
        try {
            if (hasValidLastSync) {
                try {
                    const incResult = await pool.request()
                        .input('lastSync', sql.DateTime, new Date(lastSync))
                        .query(`
                            SELECT * FROM ${view}
                            WHERE data_ultima_alteracao > @lastSync
                            ORDER BY data_ultima_alteracao ASC
                        `);
                    return {
                        records: incResult.recordset || [],
                        viewName: view,
                        isIncrementalQuery: true
                    };
                } catch (incErr) {
                    // Fallback se a view não possuir a coluna data_ultima_alteracao
                }
            }

            const fullResult = await pool.request().query(`SELECT * FROM ${view}`);
            return {
                records: fullResult.recordset || [],
                viewName: view,
                isIncrementalQuery: false
            };
        } catch (err) {
            lastErr = err;
        }
    }

    throw lastErr || new Error('Não foi possível consultar a View no SQL Server.');
}

async function postBatchWithRetry(batch, batchNumber, totalBatches) {
    const machineId = process.env.MACHINE_ID || process.env.COMPUTERNAME || os.hostname() || 'unknown';
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
        try {
            try {
                await apiClient.post(API_URL, {
                    dados: batch,
                    machineId,
                    machine_id: machineId,
                    batchNumber,
                    totalBatches
                }, {
                    headers: {
                        'x-api-key': API_KEY,
                        'x-machine-id': machineId,
                        'Content-Type': 'application/json'
                    },
                    timeout: REQUEST_TIMEOUT_MS
                });
                return true;
            } catch (postErr) {
                if (API_URL.startsWith('https://') && (
                    postErr.code === 'EPROTO' ||
                    (postErr.message && (postErr.message.includes('SSL') || postErr.message.includes('tlsv1') || postErr.message.includes('alert')))
                )) {
                    const httpFallbackUrl = API_URL.replace('https://', 'http://');
                    console.warn(`⚠️ [SSL Fallback] Tentando lote ${batchNumber} via HTTP: ${httpFallbackUrl}...`);
                    await apiClient.post(httpFallbackUrl, {
                        dados: batch,
                        machineId,
                        machine_id: machineId,
                        batchNumber,
                        totalBatches
                    }, {
                        headers: {
                            'x-api-key': API_KEY,
                            'x-machine-id': machineId,
                            'Content-Type': 'application/json'
                        },
                        timeout: REQUEST_TIMEOUT_MS
                    });
                    return true;
                }
                throw postErr;
            }
        } catch (err) {
            lastError = err;
            const statusInfo = err.response ? `HTTP ${err.response.status}` : (err.code || err.message);
            console.warn(
                `⚠️ [Sincronizando] Falha no lote ${batchNumber}/${totalBatches} ` +
                `(Tentativa ${attempt}/${MAX_BATCH_RETRIES}): ${statusInfo}`
            );

            if (attempt < MAX_BATCH_RETRIES) {
                const retryWait = attempt * 1500;
                await sleep(retryWait);
            }
        }
    }

    console.error(
        `❌ [Sincronizando] Lote ${batchNumber}/${totalBatches} falhou após ${MAX_BATCH_RETRIES} tentativas ` +
        `(${lastError ? lastError.message : 'Erro desconhecido'}). Passando para o próximo lote...`
    );
    return false;
}

function resolveMaxSyncDate(records) {
    let maxTimestamp = 0;
    for (const r of records) {
        const rawDate = r.data_ultima_alteracao || r.Data_Ultima_Alteracao || r.updated_at;
        if (rawDate) {
            const ts = new Date(rawDate).getTime();
            if (Number.isFinite(ts) && ts > maxTimestamp) {
                maxTimestamp = ts;
            }
        }
    }
    return maxTimestamp > 0 ? new Date(maxTimestamp).toISOString() : new Date().toISOString();
}

async function syncData() {
    let pool;
    try {
        console.log(`\n[${new Date().toISOString()}] Iniciando verificação de sincronização...`);
        const lastSync = getLastSyncDate();
        const hasValidLastSync = Boolean(
            lastSync &&
            lastSync !== '1970-01-01T00:00:00.000Z' &&
            !Number.isNaN(new Date(lastSync).getTime())
        );

        pool = await sql.connect(dbConfig);

        const { records: rawRecords, viewName, isIncrementalQuery } = await fetchRecordsFromView(pool, lastSync);

        if (!rawRecords || rawRecords.length === 0) {
            console.log('Tudo atualizado! Nenhum registro novo para sincronizar.');
            setTimeout(syncData, SYNC_INTERVAL_MS);
            return;
        }

        const validRecords = [];
        let fallbackCount = 0;
        let ignoredZeroPriceCount = 0;
        let ignoredZeroStockOrInactiveCount = 0;
        let zeroStockUpdatesAllowed = 0;

        for (const row of rawRecords) {
            const normalized = normalizeAndSanitizeSiagoldRecord(row);
            if (!normalized) {
                ignoredZeroPriceCount++;
                continue;
            }

            const identityKey = resolveRecordIdentityKey(normalized);
            const hasPositiveStock = normalized.stock > 0 && normalized.active !== false;

            if (!hasPositiveStock) {
                const canSendStockOut =
                    hasValidLastSync &&
                    (isIncrementalQuery || (identityKey && knownActiveProductKeys.has(identityKey)));

                if (!canSendStockOut) {
                    ignoredZeroStockOrInactiveCount++;
                    continue;
                }

                zeroStockUpdatesAllowed++;
                if (identityKey) {
                    knownActiveProductKeys.delete(identityKey);
                }
            } else if (identityKey) {
                knownActiveProductKeys.add(identityKey);
            }

            if (normalized._priceFallbackApplied) {
                fallbackCount++;
            }
            delete normalized._priceFallbackApplied;
            validRecords.push(normalized);
        }

        console.log(
            `[Siagold] ${rawRecords.length} lidos | ` +
            `${validRecords.length} válidos (estoque > 0${zeroStockUpdatesAllowed > 0 ? ` + ${zeroStockUpdatesAllowed} baixas p/ 0` : ''}) | ` +
            `${ignoredZeroStockOrInactiveCount} ignorados por estoque zerado/inativo` +
            (fallbackCount > 0 ? ` | ${fallbackCount} corrigidos via PMC` : '') +
            (ignoredZeroPriceCount > 0 ? ` | ${ignoredZeroPriceCount} sem preço` : '') +
            ` [View: ${viewName}]`
        );

        if (validRecords.length === 0) {
            console.log('Nenhum produto elegível para sincronizar neste ciclo.');
            setTimeout(syncData, SYNC_INTERVAL_MS);
            return;
        }

        const batches = chunkArray(validRecords, BATCH_SIZE);
        const totalBatches = batches.length;

        let successBatches = 0;
        let failedBatches = 0;
        let batchIndex = 0;

        for (const batch of batches) {
            batchIndex++;
            console.log(`[Sincronizando] Enviando lote ${batchIndex} de ${totalBatches} (${batch.length} registros)...`);

            const ok = await postBatchWithRetry(batch, batchIndex, totalBatches);
            if (ok) {
                successBatches++;
            } else {
                failedBatches++;
            }

            if (batchIndex < totalBatches) {
                await sleep(BATCH_DELAY_MS);
            }
        }

        if (successBatches > 0 && failedBatches === 0) {
            console.log(`✅ Todos os ${totalBatches} lotes (${validRecords.length} produtos) sincronizados com sucesso!`);
            saveLastSyncDate(resolveMaxSyncDate(validRecords));
            setTimeout(syncData, SYNC_INTERVAL_MS);
        } else if (successBatches > 0) {
            console.warn(`⚠️ Sincronização parcial: ${successBatches}/${totalBatches} lotes enviados (${failedBatches} falharam).`);
            setTimeout(syncData, SYNC_INTERVAL_MS);
        } else {
            throw new Error(`Falha no envio de todos os ${totalBatches} lotes.`);
        }
    } catch (error) {
        console.error(`❌ Erro durante a sincronização: ${error.message}`);
        console.log(`⚠️ Tentando novamente em ${RETRY_INTERVAL_MS / 1000 / 60} minutos...`);
        setTimeout(syncData, RETRY_INTERVAL_MS);
    } finally {
        if (pool) {
            try {
                await pool.close();
            } catch (err) {
                console.error('Erro ao fechar conexão com o banco:', err.message);
            }
        }
    }
}

console.log('===================================================');
console.log('🚀 Agente de Sincronização FarmaFlow (Siagold) Iniciado');
console.log(`📦 Envio Fracionado: lotes de até ${BATCH_SIZE} registros (timeout ${REQUEST_TIMEOUT_MS / 1000}s)`);
console.log('===================================================');
syncData();
