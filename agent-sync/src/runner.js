const readline = require('readline');
const {
    loadConfig,
    saveConfig,
    getLastSyncDate,
    updateLastSyncDate,
    loadSyncCache,
    saveSyncCache,
    extractProductKey,
    buildProductSignature
} = require('./shared/state');
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
const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // Full Sync programado a cada 6 horas

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
    console.log(`🧠 Delta Sync Inteligente por Hash Ativo (farmaflow_sync_cache.json)`);
    console.log('===================================================\n');

    let config = loadConfig();

    if (!config || !config.activated) {
        console.log('⚠️ Agente não configurado.');
        const token = await askForToken();

        console.log('Validando token na nuvem...');
        try {
            const apiConfig = await validateToken(token);

            const isSqlServerCompatible =
                (expectedErpType === 'siagold' || expectedErpType === 'inovafarma') &&
                (apiConfig.erpType === 'siagold' || apiConfig.erpType === 'inovafarma');

            if (apiConfig.erpType !== expectedErpType && !isSqlServerCompatible) {
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
    const syncCache = loadSyncCache();

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
            const nowMs = Date.now();
            const cachedKeysCount = Object.keys(syncCache.items || {}).length;
            const isFullSyncDue =
                cachedKeysCount === 0 ||
                !syncCache.lastFullSyncAt ||
                (nowMs - Number(syncCache.lastFullSyncAt) >= FULL_SYNC_INTERVAL_MS);

            const records = await connector.getChangedRecords(lastSync, {
                syncCacheItems: syncCache.items,
                isFullSyncDue
            });

            const validRecords = Array.isArray(records) ? records : [];
            const totalRead = typeof records?.totalRead === 'number' ? records.totalRead : validRecords.length;

            // Filtra os registros usando o Delta Sync Inteligente por Hash (estoque|preco|preco_promocional|nome)
            const recordsToSend = [];
            const pendingSignatures = new Map();

            for (const record of validRecords) {
                const key = extractProductKey(record);
                const sig = buildProductSignature(record);

                if (!key) {
                    recordsToSend.push(record);
                    continue;
                }

                const prevSig = syncCache.items[key];
                const stockVal = Number(record.stock ?? record.estoque ?? 0);
                const isActive = record.active !== false;

                if (isFullSyncDue) {
                    // No Full Sync (1ª execução ou a cada 6h), envia todos os produtos válidos com estoque > 0
                    // ou produtos que estavam ativos no cache e zeraram estoque
                    if ((stockVal > 0 && isActive) || (prevSig && prevSig !== sig)) {
                        recordsToSend.push(record);
                        pendingSignatures.set(key, sig);
                    }
                } else {
                    // No Delta Sync (a cada 60s), envia APENAS produtos cujo estoque, preço, promoção ou nome mudaram
                    if (!prevSig) {
                        if (stockVal > 0 && isActive) {
                            recordsToSend.push(record);
                            pendingSignatures.set(key, sig);
                        }
                    } else if (prevSig !== sig) {
                        recordsToSend.push(record);
                        pendingSignatures.set(key, sig);
                    }
                }
            }

            if (recordsToSend.length === 0) {
                console.log(
                    `[Sincronizando] ${totalRead} lidos | 0 alterados desde o último ciclo. Nenhum lote precisou ser enviado.`
                );
            } else {
                const totalBatches = Math.ceil(recordsToSend.length / BATCH_SIZE);
                const syncModeLabel = isFullSyncDue
                    ? (cachedKeysCount === 0 ? 'Carga Inicial Completa' : 'Full Sync Programado 6h')
                    : 'Delta Sync Inteligente';

                console.log(
                    `[Sincronizando] ${totalRead} lidos | ${recordsToSend.length} alterados desde o último ciclo (${syncModeLabel} - ${totalBatches} lotes de até ${BATCH_SIZE} produtos).`
                );

                const syncResult = await sendData(config.apiKey, recordsToSend);

                if (!syncResult || syncResult.failedBatches === 0) {
                    for (const [key, sig] of pendingSignatures.entries()) {
                        syncCache.items[key] = sig;
                    }
                    if (isFullSyncDue) {
                        syncCache.lastFullSyncAt = Date.now();
                    }
                    saveSyncCache(syncCache);

                    const nextSyncIso = resolveMaxSyncDate(recordsToSend);
                    updateLastSyncDate(nextSyncIso);
                    console.log(`✅ Todos os ${totalBatches} lotes (${recordsToSend.length} produtos) foram sincronizados e salvos no cache local.`);
                } else {
                    console.warn(
                        `⚠️ Sincronização concluída parcialmente (${syncResult.successBatches}/${syncResult.totalBatches} lotes). ` +
                        `Os itens pendentes serão reenviados no próximo ciclo.`
                    );
                }
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
