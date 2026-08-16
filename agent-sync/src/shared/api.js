// Força compatibilidade SSL/TLS mesmo em ambientes Windows legados
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const axios = require('axios');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

// Tenta carregar as variáveis de ambiente a partir do arquivo .env no diretório de execução atual (process.cwd())
try {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (e) {
    // dotenv é opcional
}

function getMachineId() {
    try {
        return process.env.MACHINE_ID || process.env.COMPUTERNAME || os.hostname() || 'unknown';
    } catch (e) {
        return 'unknown';
    }
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
    timeout: 25000,
    headers: {
        'User-Agent': 'FarmaFlow-Desktop-Agent/1.0',
        'Accept': 'application/json, text/plain, */*'
    }
});

/**
 * Normaliza e sanitiza a URL de integração, corrigindo concatenações incorretas
 * como farmaflow.online.nexoia.online e garantindo a estrutura correta /api/v1.
 */
function sanitizeBaseUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') {
        return 'https://farmaflow.nexoia.online/api/v1';
    }
    let url = inputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    // Corrige concatenações duplas de domínios (ex: farmaflow.online.nexoia.online)
    url = url.replace(/farmaflow\.online\.nexoia\.online/gi, 'farmaflow.nexoia.online');
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
    const rawEnv = process.env.API_BASE_URL || process.env.API_URL || '';
    const primary = sanitizeBaseUrl(rawEnv);
    const fallbacks = [
        'https://farmaflow.nexoia.online/api/v1',
        'https://farmaflow.online/api/v1'
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
 * Executa requisição POST com fallback inteligente entre os domínios da FarmaFlow
 */
async function postWithFallback(path, data, config = {}) {
    const candidates = getCandidateBaseUrls();
    // Prioriza a URL que já teve sucesso anteriormente
    const sortedCandidates = [activeBaseUrl, ...candidates.filter(c => c !== activeBaseUrl)];
    
    let lastError = null;
    for (let i = 0; i < sortedCandidates.length; i++) {
        const baseUrl = sortedCandidates[i];
        const targetUrl = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
        
        try {
            const response = await apiClient.post(targetUrl, data, {
                ...config,
                headers: {
                    ...config.headers,
                    'x-agent-target': baseUrl
                }
            });
            
            // Marca a URL como ativa após o primeiro sucesso
            if (activeBaseUrl !== baseUrl) {
                activeBaseUrl = baseUrl;
                console.log(`[INFO] Conexão estabelecida com sucesso com o servidor em: ${baseUrl}`);
            }
            return { response, targetUrl };
        } catch (err) {
            lastError = err;
            const isSslOrNetwork = err.code === 'EPROTO' || 
                                   err.code === 'ECONNRESET' || 
                                   err.code === 'ECONNREFUSED' || 
                                   err.code === 'ENOTFOUND' || 
                                   err.code === 'ETIMEDOUT' ||
                                   (err.message && (err.message.includes('SSL') || err.message.includes('tlsv1') || err.message.includes('alert')));
            
            if (i < sortedCandidates.length - 1 && isSslOrNetwork) {
                console.warn(`⚠️ [REDE/SSL] Falha na URL "${targetUrl}" (${err.code || err.message}). Tentando rota alternativa...`);
                continue;
            }
            // Se for erro HTTP 4xx (ex: 400 token inválido, 401 não autorizado), não adianta tentar outra URL
            if (err.response && err.response.status < 500) {
                break;
            }
        }
    }
    
    throw lastError;
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
            }
        });
        
        console.log(`[DEBUG] Token validado com sucesso na URL: ${targetUrl}`);
        console.log(`- Código de Status HTTP: ${response.status} (${response.statusText})`);
        return response.data; // Espera: { erpType, dbConfig, apiKey }
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

async function sendData(apiKey, data) {
    const machineId = getMachineId();
    try {
        const { response } = await postWithFallback('/integration', {
            dados: data,
            machineId,
            machine_id: machineId
        }, {
            headers: {
                'x-api-key': apiKey,
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });
        return response.data;
    } catch (error) {
        console.error(`[DEBUG ERROR] Falha ao enviar dados de sincronização:`);
        console.error(`- URL Base: "${activeBaseUrl}"`);
        if (error.response) {
            console.error(`- Código de Status HTTP: ${error.response.status}`);
            console.error(`- Erro da API:`, JSON.stringify(error.response.data));
        } else {
            console.error(`- Erro de Rede/Conexão: ${error.message}`);
        }
        throw error;
    }
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
            timeout: 8000
        });
    } catch (error) {
        console.error(`[DEBUG ERROR] Falha ao enviar heartbeat: ${error.message}`);
        throw error;
    }
}

module.exports = {
    validateToken,
    sendData,
    sendHeartbeat,
    getMachineId,
    sanitizeBaseUrl,
    activeBaseUrl
};

