// Força compatibilidade SSL/TLS mesmo em ambientes Windows legados
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { normalizeAndSanitizeSiagoldRecord } = require('./priceNormalizer');

// Tenta carregar as variáveis de ambiente a partir do arquivo .env no diretório de execução atual (process.cwd())
try {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (e) {
    // dotenv é opcional
}

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

function getMachineId() {
    try {
        return process.env.MACHINE_ID || process.env.COMPUTERNAME || os.hostname() || 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

/**
 * Lê diretamente o arquivo .env ou farmaflow_config.json no diretório de trabalho atual,
 * garantindo compatibilidade mesmo quando empacotado como executável standalone (.exe)
 */
function getCustomApiUrl() {
    // 1. Checa farmaflow_config.json
    try {
        const configFile = path.join(process.cwd(), 'farmaflow_config.json');
        if (fs.existsSync(configFile)) {
            const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            if (parsed && (parsed.apiUrl || parsed.apiBaseUrl || parsed.url)) {
                return parsed.apiUrl || parsed.apiBaseUrl || parsed.url;
            }
        }
    } catch (e) {}

    // 2. Lê manualmente o arquivo .env no diretório atual
    try {
        const envFile = path.join(process.cwd(), '.env');
        if (fs.existsSync(envFile)) {
            const content = fs.readFileSync(envFile, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                const match = line.match(/^\s*(API_URL|API_BASE_URL)\s*=\s*(.+)$/i);
                if (match) {
                    return match[2].trim().replace(/^["']|["']$/g, '');
                }
            }
        }
    } catch (e) {}

    // 3. Checa process.env
    if (process.env.API_BASE_URL || process.env.API_URL) {
        return process.env.API_BASE_URL || process.env.API_URL;
    }

    return 'https://farmaflow.online/api/v1';
}

/**
 * Agente HTTPS resiliente com suporte explícito a TLS 1.2/1.3,
 * ciphers modernos com suporte a compatibilidade de segurança,
 * keep-alive e prevenção de erros EPROTO de handshake.
 */
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

const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000
});

const apiClient = axios.create({
    httpsAgent,
    httpAgent,
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
        'User-Agent': 'FarmaFlow-Desktop-Agent/2.0',
        'Accept': 'application/json, text/plain, */*'
    }
});

/**
 * Normaliza e sanitiza a URL de integração, corrigindo concatenações incorretas
 * e garantindo a estrutura correta /api/v1 (suportando farmaflow.online e farmaflow.site).
 */
function sanitizeBaseUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') {
        return 'https://farmaflow.online/api/v1';
    }
    let url = inputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    // Substitui domínios legados ou concatenados incorretamente
    url = url.replace(/farmaflow\.nexoia\.online/gi, 'farmaflow.online');
    url = url.replace(/farmaflow\.online\.nexoia\.online/gi, 'farmaflow.online');
    url = url.replace(/nexoia\.online\.farmaflow\.online/gi, 'farmaflow.online');

    // Remove barras finais
    url = url.replace(/\/+$/, '');

    // Remove sufixos de endpoints se foram informados na base
    url = url.replace(/\/integration(\/validate-token|\/heartbeat|\/ping)?\/?$/i, '');

    // Garante que termine com /api/v1 se não tiver /api/
    if (!url.includes('/api/')) {
        url = `${url}/api/v1`;
    }
    return url;
}

// Lista de URLs base candidatas para fallback em caso de falha de conexão/SSL
function getCandidateBaseUrls() {
    const rawEnv = getCustomApiUrl();
    const primary = sanitizeBaseUrl(rawEnv);
    const fallbacks = [
        'https://farmaflow.online/api/v1',
        'https://www.farmaflow.online/api/v1'
    ];

    const candidates = [primary];
    for (const fb of fallbacks) {
        if (!candidates.includes(fb)) {
            candidates.push(fb);
        }
    }
    return candidates;
}

let activeBaseUrl = getCandidateBaseUrls()[0];

/**
 * Executa requisição POST com fallback inteligente apenas em caso de erro de rede/DNS/SSL
 */
async function postWithFallback(pathSuffix, data, config = {}) {
    const candidates = getCandidateBaseUrls();
    const sortedCandidates = [activeBaseUrl, ...candidates.filter(c => c !== activeBaseUrl)];

    let firstError = null;
    for (let i = 0; i < sortedCandidates.length; i++) {
        const baseUrl = sortedCandidates[i];
        const targetUrl = `${baseUrl}${pathSuffix.startsWith('/') ? '' : '/'}${pathSuffix}`;

        try {
            const response = await apiClient.post(targetUrl, data, {
                timeout: REQUEST_TIMEOUT_MS,
                ...config,
                headers: {
                    ...config.headers,
                    'x-agent-target': baseUrl
                }
            });

            if (activeBaseUrl !== baseUrl) {
                activeBaseUrl = baseUrl;
                console.log(`[INFO] Conexão estabelecida com sucesso com o servidor em: ${baseUrl}`);
            }
            return { response, targetUrl };
        } catch (err) {
            if (!firstError) firstError = err;

            const isSslOrNetwork =
                !err.response && (
                    err.code === 'EPROTO' ||
                    err.code === 'ECONNRESET' ||
                    err.code === 'ECONNREFUSED' ||
                    err.code === 'ENOTFOUND' ||
                    err.code === 'ETIMEDOUT' ||
                    err.code === 'ECONNABORTED' ||
                    err.code === 'EAI_AGAIN' ||
                    (err.message && (
                        err.message.includes('SSL') ||
                        err.message.includes('tlsv1') ||
                        err.message.includes('alert') ||
                        err.message.includes('timeout') ||
                        err.message.includes('socket hang up')
                    ))
                );

            if (i < sortedCandidates.length - 1 && isSslOrNetwork) {
                console.warn(`⚠️ [REDE/SSL] Falha na URL "${targetUrl}" (${err.code || err.message}). Tentando rota alternativa...`);
                continue;
            }

            // Se houve resposta HTTP do servidor (ex: 4xx/5xx), não troca para outro domínio para não mascarar o erro real com 405
            break;
        }
    }

    throw firstError;
}

async function validateToken(token) {
    const machineId = getMachineId();
    console.log(`\n[DEBUG] Iniciando validação de token...`);
    console.log(`- Base URL Ativa: "${activeBaseUrl}"`);
    console.log(`- Payload: { token: "${token ? token.substring(0, 8) + '...' : 'vazio'}", machineId: "${machineId}" }`);

    try {
        const { response, targetUrl } = await postWithFallback('/integration/validate-token', {
            token,
            machineId,
            machine_id: machineId
        }, {
            headers: {
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT_MS
        });

        console.log(`[DEBUG] Token validado com sucesso na URL: ${targetUrl}`);
        console.log(`- Código de Status HTTP: ${response.status} (${response.statusText})`);
        return response.data;
    } catch (error) {
        console.error(`\n[DEBUG ERROR] Falha na requisição de validação do token:`);
        if (error.response) {
            console.error(`- Código de Status HTTP Retornado: ${error.response.status} (${error.response.statusText})`);
            console.error(`- Corpo da Resposta de Erro:`, JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error(`- Nenhuma resposta recebida do servidor.`);
            console.error(`- Código do Erro de Conexão: ${error.code || 'Desconhecido'}`);
            console.error(`- Detalhes/Mensagem: ${error.message}`);
        } else {
            console.error(`- Erro Geral: ${error.message}`);
        }
        console.error(`===================================================\n`);

        throw new Error(error.response?.data?.message || error.response?.data?.error || `Erro ao validar token ou se conectar ao servidor (${error.code || error.message}).`);
    }
}

/**
 * Envia um único lote com até MAX_BATCH_RETRIES tentativas e timeout de 60s.
 * Se o lote de 200 itens falhar após as tentativas (ex: erro em algum item específico),
 * divide automaticamente o lote em sub-lotes menores (50 itens) para isolar e salvar todos os itens válidos.
 */
async function sendSingleBatchWithRetry(apiKey, batch, batchNumber, totalBatches, machineId, isSubBatch = false) {
    let lastBatchError = null;

    for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
        try {
            const { response } = await postWithFallback('/integration', {
                dados: batch,
                machineId,
                machine_id: machineId,
                batchNumber,
                totalBatches
            }, {
                headers: {
                    'x-api-key': apiKey,
                    'x-machine-id': machineId,
                    'Content-Type': 'application/json'
                },
                timeout: REQUEST_TIMEOUT_MS
            });

            return {
                success: true,
                data: response.data,
                attempt
            };
        } catch (error) {
            lastBatchError = error;
            const detailMsg = error.response?.data?.details || error.response?.data?.error || '';
            const statusInfo = error.response
                ? `HTTP ${error.response.status}${detailMsg ? ` (${detailMsg})` : ''}`
                : (error.code || error.message);
            console.warn(
                `⚠️ [Sincronizando] Falha no lote ${batchNumber}/${totalBatches} ` +
                `(Tentativa ${attempt}/${MAX_BATCH_RETRIES}): ${statusInfo}`
            );

            if (attempt < MAX_BATCH_RETRIES) {
                const retryDelay = attempt * 1500;
                console.log(`⏳ Aguardando ${retryDelay}ms antes de reenviar o lote ${batchNumber}...`);
                await sleep(retryDelay);
            }
        }
    }

    // Fallback de Sub-lotes: divide o lote de 200 em fatias menores de 50 registros para garantir o salvamento
    if (!isSubBatch && batch.length > 50) {
        console.log(`🔄 [Sincronizando] Dividindo lote ${batchNumber} em sub-lotes de 50 registros para envio seguro...`);
        const subChunks = chunkArray(batch, 50);
        let subSuccess = 0;
        for (let s = 0; s < subChunks.length; s++) {
            const subRes = await sendSingleBatchWithRetry(
                apiKey,
                subChunks[s],
                `${batchNumber}.${s + 1}`,
                totalBatches,
                machineId,
                true
            );
            if (subRes.success) subSuccess++;
            await sleep(300);
        }
        if (subSuccess > 0) {
            return {
                success: true,
                partialSubBatch: subSuccess < subChunks.length
            };
        }
    }

    console.error(
        `❌ [Sincronizando] Lote ${batchNumber}/${totalBatches} falhou após ${MAX_BATCH_RETRIES} tentativas. ` +
        `Prosseguindo para o próximo lote sem abortar a sincronização.`
    );
    return {
        success: false,
        error: lastBatchError
    };
}

/**
 * Envia os produtos de forma estritamente fracionada em lotes de no máximo 200 registros (BATCH_SIZE = 200),
 * sequencialmente (for...of com await), com intervalo de 500ms entre lotes, timeout de 60s e até 3 retries por lote.
 */
async function sendData(apiKey, data) {
    const machineId = getMachineId();
    const rawArray = Array.isArray(data) ? data : [];

    if (rawArray.length === 0) {
        return { success: true, totalSent: 0, totalBatches: 0, failedBatches: 0 };
    }

    // Higienização e normalização preventiva de preços antes de montar os lotes HTTP
    const sanitizedRecords = [];
    for (const item of rawArray) {
        const cleaned = normalizeAndSanitizeSiagoldRecord(item);
        if (cleaned) {
            delete cleaned._priceFallbackApplied;
            sanitizedRecords.push(cleaned);
        }
    }

    if (sanitizedRecords.length === 0) {
        console.log('⚠️ Nenhum registro com preço válido (> 0) para enviar após higienização.');
        return { success: true, totalSent: 0, totalBatches: 0, failedBatches: 0 };
    }

    const batches = chunkArray(sanitizedRecords, BATCH_SIZE);
    const totalBatches = batches.length;

    let successBatches = 0;
    let failedBatches = 0;
    let totalSent = 0;
    let batchIndex = 0;

    for (const batch of batches) {
        batchIndex++;
        console.log(`[Sincronizando] Enviando lote ${batchIndex} de ${totalBatches} (${batch.length} registros)...`);

        const result = await sendSingleBatchWithRetry(apiKey, batch, batchIndex, totalBatches, machineId);
        if (result.success) {
            successBatches++;
            totalSent += batch.length;
        } else {
            failedBatches++;
        }

        // Intervalo de 500ms entre os lotes para não sobrecarregar o Nginx nem a VPS
        if (batchIndex < totalBatches) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    if (successBatches === 0 && failedBatches > 0) {
        throw new Error(`Todos os ${totalBatches} lotes falharam durante o envio.`);
    }

    console.log(
        `✅ [Sincronizando] Envio em lotes finalizado: ${successBatches}/${totalBatches} lotes confirmados ` +
        `(${totalSent} produtos enviados${failedBatches > 0 ? `, ${failedBatches} lotes com falha` : ''}).`
    );

    return {
        success: failedBatches === 0,
        partialSuccess: successBatches > 0 && failedBatches > 0,
        totalSent,
        totalBatches,
        successBatches,
        failedBatches
    };
}

async function sendHeartbeat(apiKey) {
    const machineId = getMachineId();
    try {
        await postWithFallback('/integration/heartbeat', {
            apiKey,
            machineId,
            machine_id: machineId
        }, {
            headers: {
                'x-api-key': apiKey,
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
    } catch (error) {
        console.error(`[DEBUG ERROR] Falha ao enviar heartbeat: ${error.message}`);
        throw error;
    }
}

module.exports = {
    BATCH_SIZE,
    BATCH_DELAY_MS,
    MAX_BATCH_RETRIES,
    REQUEST_TIMEOUT_MS,
    validateToken,
    sendData,
    sendHeartbeat,
    getMachineId,
    sanitizeBaseUrl,
    activeBaseUrl,
    chunkArray,
    sleep
};
