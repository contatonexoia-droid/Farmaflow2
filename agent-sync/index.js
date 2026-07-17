require('dotenv').config();
const sql = require('mssql');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configurações via variáveis de ambiente
const API_URL = process.env.API_URL || 'https://farmaflow.nexoia.online/api/v1/integration';
const API_KEY = process.env.API_KEY || '02ebf5a7-ccec-47e1-99ae-4e00729b4df1';
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 60000; // 1 minuto
const RETRY_INTERVAL_MS = parseInt(process.env.RETRY_INTERVAL_MS) || 300000; // 5 minutos (Resiliência)

// Configuração do Banco de Dados (SQL Server)
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false, // Em redes locais, normalmente falso
        trustServerCertificate: true
    }
};

// Arquivo local para salvar a última data de sincronização (Fica na mesma pasta do executável)
const STATE_FILE = path.join(process.cwd(), 'sync_state.json');

// Função para ler a última data enviada
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
    return '1970-01-01T00:00:00.000Z'; // Padrão caso não exista
}

// Função para salvar a última data após o envio
function saveLastSyncDate(dateStr) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSyncDate: dateStr }, null, 2));
    } catch (error) {
        console.error('Erro ao salvar arquivo de estado:', error.message);
    }
}

// Loop Principal de Sincronização
async function syncData() {
    let pool;
    try {
        console.log(`\n[${new Date().toISOString()}] Iniciando verificação de sincronização...`);
        const lastSync = getLastSyncDate();
        
        // 1. Conectar ao banco de dados local
        pool = await sql.connect(dbConfig);
        
        // 2. Buscar registros alterados na View de integração
        // Nota: Ajuste "VW_INTEGRACAO_FARMAFLOW" para o nome correto que o técnico fornecer
        const query = `
            SELECT * FROM VW_INTEGRACAO_FARMAFLOW
            WHERE data_ultima_alteracao > @lastSync
            ORDER BY data_ultima_alteracao ASC
        `;
        
        const result = await pool.request()
            .input('lastSync', sql.DateTime, new Date(lastSync))
            .query(query);

        const records = result.recordset;
        
        if (records.length === 0) {
            console.log('Tudo atualizado! Nenhum registro novo para sincronizar.');
            setTimeout(syncData, SYNC_INTERVAL_MS);
            return;
        }

        console.log(`Encontrados ${records.length} novos registros para envio.`);

        // 3. Enviar os dados para a API (FarmaFlow)
        const response = await axios.post(API_URL, {
            dados: records
        }, {
            headers: {
                'x-api-key': API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15 segundos
        });

        if (response.status >= 200 && response.status < 300) {
            console.log('✅ Dados sincronizados com sucesso com o FarmaFlow AI.');
            
            // Pega a maior data de alteração do lote que acabou de ser enviado
            const maxDate = records.reduce((max, r) => {
                return (new Date(r.data_ultima_alteracao) > new Date(max)) ? r.data_ultima_alteracao : max;
            }, records[0].data_ultima_alteracao);
            
            // Salva a nova data para a próxima execução
            saveLastSyncDate(new Date(maxDate).toISOString());
            
            // Agenda próxima execução normal
            setTimeout(syncData, SYNC_INTERVAL_MS);
        } else {
            throw new Error(`Resposta inesperada da API: Status ${response.status}`);
        }

    } catch (error) {
        console.error(`❌ Erro durante a sincronização: ${error.message}`);
        console.log(`⚠️ Tentando novamente em ${RETRY_INTERVAL_MS / 1000 / 60} minutos...`);
        
        // 4. Resiliência: tentar novamente em 5 minutos
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
console.log('🚀 Agente de Sincronização FarmaFlow AI Iniciado');
console.log('===================================================');
syncData();
