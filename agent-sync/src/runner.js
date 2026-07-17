const readline = require('readline');
const { loadConfig, saveConfig, getLastSyncDate, updateLastSyncDate } = require('./shared/state');
const { validateToken, sendData, sendHeartbeat } = require('./shared/api');

const SYNC_INTERVAL_MS = 60000;
const RETRY_INTERVAL_MS = 300000;

async function askForToken() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Por favor, insira o Token de Ativação (gerado no painel FarmaFlow): ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Inicia o agente de sincronização
 * @param {string} expectedErpType O tipo de ERP (ex: 'siagold')
 * @param {class} ConnectorClass A classe do conector a ser instanciada
 */
async function startAgent(expectedErpType, ConnectorClass) {
    console.log('===================================================');
    console.log(`🚀 Agente FarmaFlow Iniciado (Módulo: ${expectedErpType.toUpperCase()})`);
    console.log('===================================================\n');

    let config = loadConfig();

    if (!config || !config.activated) {
        console.log('⚠️ Agente não configurado.');
        const token = await askForToken();
        
        console.log('Validando token na nuvem...');
        try {
            const apiConfig = await validateToken(token);
            
            if (apiConfig.erpType !== expectedErpType) {
                console.error(`❌ Erro: Este instalador é para ${expectedErpType}, mas seu token retornou ${apiConfig.erpType}.`);
                console.error(`Por favor, baixe o instalador correto no painel.`);
                process.exit(1);
            }

            config = {
                activated: true,
                erpType: apiConfig.erpType,
                dbConfig: apiConfig.dbConfig,
                apiKey: apiConfig.apiKey,
                lastSyncDate: '1970-01-01T00:00:00.000Z'
            };
            saveConfig(config);
            console.log('✅ Token validado e configurações salvas com sucesso!\n');
        } catch (error) {
            console.error('❌ Falha na ativação:', error.message);
            process.exit(1);
        }
    }

    const connector = new ConnectorClass(config.dbConfig);

    async function loop() {
        try {
            // Envia o ping (heartbeat) para manter o status "Online" no monitor
            try {
                await sendHeartbeat(config.apiKey);
            } catch (hbError) {
                console.log(`⚠️ Alerta: Não foi possível atualizar o status (heartbeat) com o servidor: ${hbError.message}`);
            }

            console.log(`[${new Date().toISOString()}] Verificando atualizações no banco...`);
            const lastSync = getLastSyncDate();
            
            const records = await connector.getChangedRecords(lastSync);
            
            if (records && records.length > 0) {
                console.log(`Encontrados ${records.length} novos registros para envio.`);
                await sendData(config.apiKey, records);
                
                const maxDate = records.reduce((max, r) => {
                    return (new Date(r.data_ultima_alteracao) > new Date(max)) ? r.data_ultima_alteracao : max;
                }, records[0].data_ultima_alteracao);
                
                updateLastSyncDate(new Date(maxDate).toISOString());
                console.log('✅ Dados sincronizados com sucesso.');
            } else {
                console.log('Tudo atualizado.');
            }
            
            setTimeout(loop, SYNC_INTERVAL_MS);
        } catch (error) {
            console.error(`❌ Erro durante a sincronização: ${error.message}`);
            console.log(`⚠️ Tentando novamente em ${RETRY_INTERVAL_MS / 60000} minutos...`);
            setTimeout(loop, RETRY_INTERVAL_MS);
        }
    }

    loop();
}

module.exports = { startAgent };
