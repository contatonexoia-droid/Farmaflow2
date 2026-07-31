const axios = require('axios');
const path = require('path');
const os = require('os');

// Tenta carregar as variáveis de ambiente a partir do arquivo .env no diretório de execução atual (process.cwd())
try {
    require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (e) {
    // dotenv é opcional, se falhar ou não houver arquivo, segue com o padrão
}

function getMachineId() {
    try {
        return process.env.MACHINE_ID || process.env.COMPUTERNAME || os.hostname() || 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

// Admite que a API_BASE pode ser sobreposta via variável de ambiente API_BASE_URL (ex: http://localhost:3000/api/v1)
const API_BASE = process.env.API_BASE_URL || 'https://farmaflow.nexoia.online/api/v1';

async function validateToken(token) {
    const targetUrl = `${API_BASE}/integration/validate-token`;
    const machineId = getMachineId();
    console.log(`\n[DEBUG] Iniciando validação de token...`);
    console.log(`- URL Alvo: "${targetUrl}"`);
    console.log(`- Payload enviado: { token: "${token ? token.substring(0, 8) + '...' : 'vazio'}", machineId: "${machineId}" }`);

    try {
        const response = await axios.post(targetUrl, { token, machineId, machine_id: machineId }, {
            headers: {
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[DEBUG] Token validado com sucesso!`);
        console.log(`- Código de Status HTTP: ${response.status} (${response.statusText})`);
        return response.data; // Espera: { erpType, dbConfig, apiKey }
    } catch (error) {
        console.error(`\n[DEBUG ERROR] Falha na requisição de validação do token:`);
        console.error(`- URL Solicitada: "${targetUrl}"`);
        
        if (error.response) {
            // O servidor respondeu com um código fora da faixa 2xx
            console.error(`- Código de Status HTTP Retornado: ${error.response.status} (${error.response.statusText})`);
            console.error(`- Corpo da Resposta de Erro (Response Data):`, JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            // A requisição foi iniciada mas nenhuma resposta foi obtida (ex: servidor offline, erro de rede, dns)
            console.error(`- Nenhuma resposta recebida do servidor.`);
            console.error(`- Código do Erro de Conexão (code): ${error.code || 'Desconhecido'}`);
            console.error(`- Detalhes/Mensagem de Erro: ${error.message}`);
            if (error.code === 'ECONNREFUSED') {
                console.error(`- [Dica de Diagnóstico]: ECONNREFUSED significa que o endereço IP foi resolvido, mas o servidor de destino recusou a conexão na porta especificada. Verifique se a API está rodando nessa porta.`);
            } else if (error.code === 'ENOTFOUND') {
                console.error(`- [Dica de Diagnóstico]: ENOTFOUND indica erro de DNS. Verifique o domínio da API ou se há conexão com a internet ativa.`);
            }
        } else {
            // Outro erro de configuração interna da requisição
            console.error(`- Erro Geral de Configuração: ${error.message}`);
        }
        console.error(`===================================================\n`);
        
        throw new Error(error.response?.data?.message || `Erro ao validar token ou se conectar ao servidor (${error.code || error.message}).`);
    }
}

async function sendData(apiKey, data) {
    const targetUrl = `${API_BASE}/integration`;
    const machineId = getMachineId();
    try {
        const response = await axios.post(targetUrl, { dados: data, machineId, machine_id: machineId }, {
            headers: {
                'x-api-key': apiKey,
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        console.error(`[DEBUG ERROR] Falha ao enviar dados de sincronização:`);
        console.error(`- URL Alvo: "${targetUrl}"`);
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
    const targetUrl = `${API_BASE}/integration/heartbeat`;
    const machineId = getMachineId();
    try {
        await axios.post(targetUrl, { apiKey, machineId, machine_id: machineId }, {
            headers: {
                'x-api-key': apiKey,
                'x-machine-id': machineId,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
    } catch (error) {
        console.error(`[DEBUG ERROR] Falha ao enviar heartbeat: ${error.message}`);
        throw error;
    }
}

module.exports = { validateToken, sendData, sendHeartbeat, getMachineId };
