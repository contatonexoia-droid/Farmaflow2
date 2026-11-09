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

// Configurações via variáveis de ambiente
const API_URL = sanitizeUrl(process.env.API_URL || process.env.API_BASE_URL);
const API_KEY = process.env.API_KEY || '02ebf5a7-ccec-47e1-99ae-4e00729b4df1';
const VIEW_NAME = process.env.DB_VIEW || 'vw_FarmaFlow_Itens';
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS, 10) || 60000; // 1 minuto
const RETRY_INTERVAL_MS = parseInt(process.env.RETRY_INTERVAL_MS, 10) || 300000; // 5 minutos

// Configuração do Banco de Dados (SQL Server - Siagold)
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

function pickFirstPositivePrice(record, keys) {
    if (!record || typeof record !== 'object') return 0;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            const val = parsePriceValue(record[key]);
            if (val > 0) return val;
        }
    }
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
 * Normaliza e higieniza os preços de um registro lido da vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW:
 * 1. Se preco_venda / Preco_Bruto / preco vier <= 0 ou null, assume preco_original / PMC / preco_tabela.
 * 2. Se houver Preco_Liquido / preco_promocional válido (> 0 e < preço base), mapeia adequadamente.
 * 3. Retorna null se TODOS os campos de preço forem <= 0.
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

    // Ignorar/filtrar apenas registros onde TODOS os campos de preço sejam <= 0
    if (rawSellingPrice <= 0 && rawOriginalPrice <= 0 && rawLiquidOrPromoPrice <= 0) {
        return null;
    }

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

    let finalOriginalPrice = rawOriginalPrice > 0 ? rawOriginalPrice : baseSellingPrice;
    let finalPromoPrice = null;

    if (rawSellingPrice > 0 && rawLiquidOrPromoPrice > rawSellingPrice) {
        baseSellingPrice = rawLiquidOrPromoPrice;
        finalPromoPrice = rawSellingPrice;
        if (finalOriginalPrice < baseSellingPrice) {
            finalOriginalPrice = baseSellingPrice;
        }
    } else if (rawLiquidOrPromoPrice > 0 && rawLiquidOrPromoPrice < baseSellingPrice) {
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

async function fetchRecordsFromView(pool, lastSync) {
    const candidateViews = Array.from(new Set([
        VIEW_NAME,
        'vw_FarmaFlow_Itens',
        'VW_INTEGRACAO_FARMAFLOW'
    ]));

    let lastErr = null;
    for (const view of candidateViews) {
        try {
            if (lastSync && lastSync !== '1970-01-01T00:00:00.000Z') {
                try {
                    const incResult = await pool.request()
                        .input('lastSync', sql.DateTime, new Date(lastSync))
                        .query(`
                            SELECT * FROM ${view}
                            WHERE (data_ultima_alteracao IS NULL OR data_ultima_alteracao > @lastSync)
                            ORDER BY data_ultima_alteracao ASC
                        `);
                    return { records: incResult.recordset || [], viewName: view };
                } catch (incErr) {
                    // Fallback se a view não possuir a coluna data_ultima_alteracao
                }
            }

            const fullResult = await pool.request().query(`SELECT * FROM ${view}`);
            return { records: fullResult.recordset || [], viewName: view };
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

// Loop Principal de Sincronização
async function syncData() {
    let pool;
    try {
        console.log(`\n[${new Date().toISOString()}] Iniciando verificação de sincronização...`);
        const lastSync = getLastSyncDate();

        // 1. Conectar ao banco de dados local
        pool = await sql.connect(dbConfig);

        // 2. Buscar registros na View de integração (vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW)
        const { records: rawRecords, viewName } = await fetchRecordsFromView(pool, lastSync);

        if (!rawRecords || rawRecords.length === 0) {
            console.log('Tudo atualizado! Nenhum registro novo para sincronizar.');
            setTimeout(syncData, SYNC_INTERVAL_MS);
            return;
        }

        // 3. Higienizar e normalizar preços antes de montar os lotes HTTP
        const validRecords = [];
        let fallbackCount = 0;
        let ignoredZeroPriceCount = 0;

        for (const row of rawRecords) {
            const normalized = normalizeAndSanitizeSiagoldRecord(row);
            if (!normalized) {
                ignoredZeroPriceCount++;
                continue;
            }
            if (normalized._priceFallbackApplied) {
                fallbackCount++;
            }
            delete normalized._priceFallbackApplied;
            validRecords.push(normalized);
        }

        console.log(
            `[Siagold] View "${viewName}": ${rawRecords.length} registros lidos | ` +
            `${validRecords.length} válidos para envio | ` +
            `${fallbackCount} corrigidos com Preço Original/PMC | ` +
            `${ignoredZeroPriceCount} ignorados (todos os preços <= 0).`
        );

        if (validRecords.length === 0) {
            console.log('Nenhum produto com preço válido (> 0) para sincronizar.');
            setTimeout(syncData, SYNC_INTERVAL_MS);
            return;
        }

        // 4. Dividir em lotes estritos de no máximo 200 produtos (BATCH_SIZE = 200)
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

// Inicialização
console.log('===================================================');
console.log('🚀 Agente de Sincronização FarmaFlow (Siagold) Iniciado');
console.log(`📦 Envio Fracionado: lotes de até ${BATCH_SIZE} registros (timeout ${REQUEST_TIMEOUT_MS / 1000}s)`);
console.log('===================================================');
syncData();
