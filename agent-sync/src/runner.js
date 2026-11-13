const readline = require('readline');
const { loadConfig, saveConfig, getLastSyncDate, updateLastSyncDate } = require('./shared/state');
const {
    validateToken,
    sendData,
    sendHeartbeat,
    fetchPendingOrders,
    confirmOrderInErp,
    reportOrderErpError,
    BATCH_SIZE
} = require('./shared/api');

const SYNC_INTERVAL_MS = 60000;
const RETRY_INTERVAL_MS = 300000;
const ORDER_POLL_INTERVAL_MS = 5000;

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

/**
 * Inicia o agente de sincronização
 * @param {string} expectedErpType O tipo de ERP (ex: 'siagold')
 * @param {class} ConnectorClass A classe do conector a ser instanciada
 */
async function startAgent(expectedErpType, ConnectorClass) {
    console.log('===================================================');
    console.log(`🚀 Agente FarmaFlow Iniciado (Módulo: ${expectedErpType.toUpperCase()})`);
    console.log(`📦 Envio Fracionado Ativo: lotes de até ${BATCH_SIZE} produtos`);
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
                apiUrl: 'https://farmaflow.online/api/v1',
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
    const processedOrderIds = new Map();

    async function heartbeatLoop() {
        try {
            await sendHeartbeat(config.apiKey);
        } catch (hbError) {
            console.log(`⚠️ Alerta: Não foi possível atualizar o status (heartbeat) com o servidor: ${hbError.message}`);
        }
        setTimeout(heartbeatLoop, 60000);
    }

    async function orderPollLoop() {
        if (typeof connector.insertPreSaleOrder !== 'function') {
            return;
        }

        try {
            const pendingOrders = await fetchPendingOrders(config.apiKey);
            if (Array.isArray(pendingOrders) && pendingOrders.length > 0) {
                const nowMs = Date.now();
                for (const [id, ts] of processedOrderIds.entries()) {
                    if (nowMs - ts > 120000) processedOrderIds.delete(id);
                }

                for (const order of pendingOrders) {
                    if (!order || !order.id) continue;
                    if (processedOrderIds.has(order.id)) continue;

                    console.log(`\n🛒 [PDV PRÉ-VENDA] Recebido pedido #${order.id} para gravação no PDV...`);
                    try {
                        const erpResult = await connector.insertPreSaleOrder(order);
                        processedOrderIds.set(order.id, Date.now());
                        await confirmOrderInErp(config.apiKey, order.id, erpResult);
                        console.log(
                            `✅ [PDV PRÉ-VENDA] Pedido #${order.id} confirmado na nuvem ` +
                            `(Pré-Venda #${erpResult.codigoPV} • Orçamento #${erpResult.codigoOrcamento}).`
                        );
                    } catch (orderErr) {
                        console.error(`❌ [PDV PRÉ-VENDA] Falha ao gravar pedido #${order.id} no banco local:`, orderErr.message);
                        await reportOrderErpError(config.apiKey, order.id, orderErr.message);
                    }
                }
            }
        } catch (pollErr) {
            // Silencioso em falhas transitórias de rede para não poluir o console a cada 5s
        }

        setTimeout(orderPollLoop, ORDER_POLL_INTERVAL_MS);
    }

    async function loop() {
        try {
            console.log(`\n[${new Date().toISOString()}] Verificando atualizações no banco...`);
            const lastSync = getLastSyncDate();

            const records = await connector.getChangedRecords(lastSync);

            if (records && records.length > 0) {
                const totalBatches = Math.ceil(records.length / BATCH_SIZE);
                console.log(
                    `Encontrados ${records.length} registros válidos para envio ` +
                    `(${totalBatches} lotes de até ${BATCH_SIZE} produtos).`
                );

                const syncResult = await sendData(config.apiKey, records);

                if (!syncResult || syncResult.failedBatches === 0) {
                    const nextSyncIso = resolveMaxSyncDate(records);
                    updateLastSyncDate(nextSyncIso);
                    console.log('✅ Todos os lotes foram sincronizados com sucesso.');
                } else {
                    console.warn(
                        `⚠️ Sincronização concluída parcialmente (${syncResult.successBatches}/${syncResult.totalBatches} lotes). ` +
                        `A data de corte será mantida para reprocessar os lotes pendentes no próximo ciclo.`
                    );
                }
            } else {
                console.log('Tudo atualizado. Nenhum registro pendente para envio.');
            }

            setTimeout(loop, SYNC_INTERVAL_MS);
        } catch (error) {
            console.error(`❌ Erro durante a sincronização: ${error.message}`);
            console.log(`⚠️ Tentando novamente em ${RETRY_INTERVAL_MS / 60000} minutos...`);
            setTimeout(loop, RETRY_INTERVAL_MS);
        }
    }

    // Inicia os loops
    heartbeatLoop();
    if (typeof connector.insertPreSaleOrder === 'function') {
        console.log('🛒 Monitoramento de Pedidos para Pré-Venda do PDV ativo (a cada 5s).');
        orderPollLoop();
    }
    loop();
}

module.exports = { startAgent };

