try {
    require('dotenv').config();
} catch (e) {}
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

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos por padrão (proteção para caixas / NFC-e)
const LARGE_CATALOG_MIN_INTERVAL_MS = 5 * 60 * 1000; // Mínimo de 5 minutos para catálogos grandes (>= 2.000 itens)
const LARGE_CATALOG_THRESHOLD = 2000;
const RETRY_INTERVAL_MS = 300000;
const ORDER_POLL_INTERVAL_MS = 5000;
const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // Full Sync programado a cada 6 horas

function resolveConfiguredSyncIntervalMs(config = {}) {
    // 1. CLI flag --interval-minutes=N ou --sync-interval-ms=N
    const args = process.argv.slice(2).map(a => String(a || '').trim());
    for (const arg of args) {
        const minMatch = arg.match(/^--(?:sync-)?interval-minutes=(\d+(?:\.\d+)?)$/i);
        if (minMatch) {
            const ms = Math.round(Number(minMatch[1]) * 60000);
            if (ms >= 30000) return ms;
        }
        const msMatch = arg.match(/^--(?:sync-)?interval-ms=(\d+)$/i);
        if (msMatch) {
            const ms = parseInt(msMatch[1], 10);
            if (ms >= 30000) return ms;
        }
    }

    // 2. Variáveis de ambiente (.env)
    if (process.env.SYNC_INTERVAL_MINUTES && !isNaN(Number(process.env.SYNC_INTERVAL_MINUTES))) {
        const ms = Math.round(Number(process.env.SYNC_INTERVAL_MINUTES) * 60000);
        if (ms >= 30000) return ms;
    }
    if (process.env.SYNC_INTERVAL_MS && !isNaN(Number(process.env.SYNC_INTERVAL_MS))) {
        const ms = parseInt(process.env.SYNC_INTERVAL_MS, 10);
        if (ms >= 30000) return ms;
    }

    // 3. Configuração local (farmaflow_config.json)
    const cfgMin = Number(config.syncIntervalMinutes ?? config.dbConfig?.syncIntervalMinutes);
    if (Number.isFinite(cfgMin) && cfgMin > 0) {
        return Math.max(30000, Math.round(cfgMin * 60000));
    }
    const cfgMs = Number(config.syncIntervalMs ?? config.dbConfig?.syncIntervalMs);
    if (Number.isFinite(cfgMs) && cfgMs >= 30000) {
        return Math.round(cfgMs);
    }

    return DEFAULT_SYNC_INTERVAL_MS;
}

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

async function askIgnorePromotionCampaigns(defaultValue = false) {
    if (!process.stdin.isTTY) {
        return Boolean(defaultValue);
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const defaultHint = defaultValue ? 'S/n' : 's/N';
    return new Promise(resolve => {
        rl.question(
            `Ignorar campanhas da aba Promoção (usar apenas Preço Prom. do produto)? (${defaultHint}): `,
            (answer) => {
                rl.close();
                const cleaned = String(answer || '').trim().toLowerCase();
                if (!cleaned) {
                    return resolve(Boolean(defaultValue));
                }
                resolve(['s', 'sim', 'y', 'yes', '1', 'true'].includes(cleaned));
            }
        );
    });
}

function resolveCliIgnorePromoFlag() {
    const args = process.argv.slice(2).map(a => String(a || '').trim().toLowerCase());
    if (args.includes('--ignore-promo-campaigns') || args.includes('--ignorar-campanhas')) {
        return true;
    }
    if (args.includes('--use-promo-campaigns') || args.includes('--usar-campanhas')) {
        return false;
    }
    return undefined;
}

function normalizeBranchCodeValue(val) {
    if (val === undefined || val === null) return null;
    const cleaned = String(val).trim();
    return cleaned.length > 0 ? cleaned : null;
}

function resolveCliBranchCode() {
    const args = process.argv.slice(2).map(a => String(a || '').trim());
    for (const arg of args) {
        const match = arg.match(/^--(?:branch-code|branch|filial|codigo-filial)=(.+)$/i);
        if (match) {
            return normalizeBranchCodeValue(match[1]);
        }
    }
    return null;
}

function resolveConfiguredBranchCode(localConfig = {}, cloudConfig = {}) {
    const cliBranch = resolveCliBranchCode();
    if (cliBranch) return cliBranch;

    const envBranch = normalizeBranchCodeValue(
        process.env.BRANCH_CODE ||
        process.env.ERP_BRANCH_CODE ||
        process.env.CODIGO_FILIAL
    );
    if (envBranch) return envBranch;

    const localBranch = normalizeBranchCodeValue(
        localConfig?.branchCode ??
        localConfig?.branch_code ??
        localConfig?.codigoFilial ??
        localConfig?.codigo_filial ??
        localConfig?.dbConfig?.branchCode ??
        localConfig?.dbConfig?.branch_code ??
        localConfig?.dbConfig?.codigoFilial ??
        localConfig?.dbConfig?.codigo_filial
    );
    if (localBranch) return localBranch;

    const cloudBranch = normalizeBranchCodeValue(
        cloudConfig?.branchCode ??
        cloudConfig?.branch_code ??
        cloudConfig?.dbConfig?.branchCode ??
        cloudConfig?.dbConfig?.branch_code
    );
    if (cloudBranch) return cloudBranch;

    return null;
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
    console.log(`🛡️ Blindagem NFC-e / PDV: SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED em 100% das consultas`);
    console.log('===================================================\n');

    let config = loadConfig();
    const cliIgnorePromo = resolveCliIgnorePromoFlag();

    if (!config || !config.activated) {
        const existingConfig = config || {};
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

            const remoteIgnorePromo = Boolean(
                apiConfig.ignorePromotionCampaigns ??
                apiConfig.ignore_promotion_campaigns ??
                apiConfig.dbConfig?.ignorePromotionCampaigns ??
                false
            );
            const ignorePromotionCampaigns =
                typeof cliIgnorePromo === 'boolean'
                    ? cliIgnorePromo
                    : await askIgnorePromotionCampaigns(remoteIgnorePromo);

            const resolvedBranchCode = resolveConfiguredBranchCode(existingConfig, apiConfig);
            const mergedDbConfig = {
                ...(apiConfig.dbConfig || {}),
                ...(existingConfig.dbConfig && typeof existingConfig.dbConfig === 'object' ? existingConfig.dbConfig : {}),
                ignorePromotionCampaigns,
                enablePdvPreSale: false
            };
            if (resolvedBranchCode) {
                mergedDbConfig.branchCode = resolvedBranchCode;
            } else {
                delete mergedDbConfig.branchCode;
            }

            config = {
                ...existingConfig,
                activated: true,
                erpType: apiConfig.erpType,
                readOnlyMode: true,
                enablePdvPreSale: false,
                syncIntervalMinutes: existingConfig.syncIntervalMinutes || 5,
                branchCode: resolvedBranchCode,
                dbConfig: mergedDbConfig,
                ignorePromotionCampaigns,
                apiKey: apiConfig.apiKey,
                apiUrl: existingConfig.apiUrl || 'https://farmaflow.online/api/v1',
                lastSyncDate: existingConfig.lastSyncDate || '1970-01-01T00:00:00.000Z'
            };
            saveConfig(config);
            console.log('✅ Token validado e configurações salvas com sucesso!\n');
        } catch (error) {
            console.error('❌ Falha na ativação:', error.message);
            process.exit(1);
        }
    } else if (typeof cliIgnorePromo === 'boolean' && config.ignorePromotionCampaigns !== cliIgnorePromo) {
        config.ignorePromotionCampaigns = cliIgnorePromo;
        if (config.dbConfig && typeof config.dbConfig === 'object') {
            config.dbConfig.ignorePromotionCampaigns = cliIgnorePromo;
        }
        saveConfig(config);
    }

    const effectiveBranchCode = resolveConfiguredBranchCode(config, {});
    if (config.dbConfig && typeof config.dbConfig === 'object') {
        if (effectiveBranchCode) {
            if (config.branchCode !== effectiveBranchCode || config.dbConfig.branchCode !== effectiveBranchCode) {
                config.branchCode = effectiveBranchCode;
                config.dbConfig.branchCode = effectiveBranchCode;
                saveConfig(config);
            }
        } else if ('branchCode' in config.dbConfig && !config.dbConfig.branchCode) {
            delete config.dbConfig.branchCode;
        }
    }

    const effectiveIgnorePromo = Boolean(
        config.ignorePromotionCampaigns ??
        config.ignore_promotion_campaigns ??
        config.dbConfig?.ignorePromotionCampaigns ??
        false
    );
    const enablePdvPreSale =
        String(process.env.ENABLE_PDV_PRESALE ?? config?.enablePdvPreSale ?? 'false')
            .trim()
            .toLowerCase() === 'true';

    if (config.dbConfig && typeof config.dbConfig === 'object') {
        config.dbConfig.ignorePromotionCampaigns = effectiveIgnorePromo;
        config.dbConfig.enablePdvPreSale = enablePdvPreSale;
    }

    let currentSyncIntervalMs = resolveConfiguredSyncIntervalMs(config);
    let hasLoggedLargeCatalogIntervalGuard = false;
    let isSyncRunning = false;

    console.log(
        `🏢 Filial configurada (branchCode): ${
            effectiveBranchCode ? effectiveBranchCode : 'NÃO DEFINIDA (sem filtro fixo por filial)'
        }`
    );
    console.log(
        `🏷️  Ignorar campanhas da aba Promoção (usar apenas Preço Prom. do produto): ${
            effectiveIgnorePromo ? 'SIM (Ativado)' : 'NÃO (Valida campanhas por Data + Dia da Semana)'
        }`
    );
    console.log(
        `⏱️  Intervalo de Sincronização: ${(currentSyncIntervalMs / 60000).toFixed(1)} minuto(s) (Mínimo automático de 5 min para catálogos >= ${LARGE_CATALOG_THRESHOLD} itens)`
    );
    console.log(
        `🔒 Modo SQL Server: ${
            enablePdvPreSale
                ? 'LEITURA + PRÉ-VENDA PDV (Opt-in ENABLE_PDV_PRESALE=true)'
                : '100% SOMENTE LEITURA POR PADRÃO (Gravação de pedidos no PDV desativada)'
        }`
    );

    const connector = new ConnectorClass(config.dbConfig);
    connector.branchCode = effectiveBranchCode;
    connector.ignorePromotionCampaigns = effectiveIgnorePromo;
    connector.enablePdvPreSale = enablePdvPreSale;
    const processedOrderIds = new Map();
    const syncCache = loadSyncCache();

    async function heartbeatLoop() {
        try {
            const hbData = await sendHeartbeat(config.apiKey);
            let configChanged = false;
            if (hbData && typeof hbData.ignore_promotion_campaigns === 'boolean') {
                const cloudFlag = hbData.ignore_promotion_campaigns;
                if (Boolean(connector.ignorePromotionCampaigns) !== cloudFlag) {
                    console.log(
                        `\n🔄 [Configuração Remota] Opção "Ignorar campanhas da aba Promoção (usar apenas Preço Prom. do produto)" alterada no painel para: ${
                            cloudFlag ? 'SIM' : 'NÃO'
                        }`
                    );
                    connector.ignorePromotionCampaigns = cloudFlag;
                    config.ignorePromotionCampaigns = cloudFlag;
                    if (config.dbConfig && typeof config.dbConfig === 'object') {
                        config.dbConfig.ignorePromotionCampaigns = cloudFlag;
                    }
                    configChanged = true;
                }
            }

            // Só adota branch_code remoto se ainda não houver um branchCode definido localmente no farmaflow_config.json / CLI / env
            const localPinnedBranch = resolveConfiguredBranchCode(config, {});
            const remoteBranch = normalizeBranchCodeValue(hbData?.branch_code ?? hbData?.branchCode);
            if (!localPinnedBranch && remoteBranch && connector.branchCode !== remoteBranch) {
                console.log(`\n🏢 [Configuração Remota] Filial (branchCode) recebida da nuvem: ${remoteBranch}`);
                connector.branchCode = remoteBranch;
                config.branchCode = remoteBranch;
                if (config.dbConfig && typeof config.dbConfig === 'object') {
                    config.dbConfig.branchCode = remoteBranch;
                }
                configChanged = true;
            }

            if (configChanged) {
                saveConfig(config);
                syncCache.lastFullSyncAt = 0;
                saveSyncCache(syncCache);
            }
        } catch (hbError) {
            console.log(`⚠️ Alerta: Não foi possível atualizar o status (heartbeat) com o servidor: ${hbError.message}`);
        }
        setTimeout(heartbeatLoop, 60000);
    }

    async function orderPollLoop() {
        if (!enablePdvPreSale || typeof connector.insertPreSaleOrder !== 'function') {
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
                        const summaryLabel =
                            erpResult.erpOrderId ||
                            (erpResult.numeroCesta && erpResult.codigoVenda
                                ? `Cesta #${erpResult.numeroCesta} (Venda #${erpResult.codigoVenda})`
                                : `Pré-Venda #${erpResult.codigoPV} • Orçamento #${erpResult.codigoOrcamento}`);
                        console.log(
                            `✅ [PDV PRÉ-VENDA] Pedido #${order.id} confirmado na nuvem (${summaryLabel}).`
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
        if (isSyncRunning) {
            console.warn(
                `⏳ [Trava de Concorrência] Sincronização anterior ainda está em andamento. Ciclo ignorado para proteger o SQL Server / NFC-e.`
            );
            return;
        }

        isSyncRunning = true;
        let nextDelayMs = currentSyncIntervalMs;

        try {
            console.log(`\n[${new Date().toISOString()}] Verificando atualizações no banco (READ UNCOMMITTED)...`);
            const lastSync = getLastSyncDate();
            const nowMs = Date.now();
            const cachedKeysCount = Object.keys(syncCache.items || {}).length;
            const isFullSyncDue =
                cachedKeysCount === 0 ||
                !syncCache.lastFullSyncAt ||
                (nowMs - Number(syncCache.lastFullSyncAt) >= FULL_SYNC_INTERVAL_MS);

            const records = await connector.getChangedRecords(lastSync, {
                syncCacheItems: syncCache.items,
                isFullSyncDue,
                ignorePromotionCampaigns: connector.ignorePromotionCampaigns
            });

            const validRecords = Array.isArray(records) ? records : [];
            const totalRead = typeof records?.totalRead === 'number' ? records.totalRead : validRecords.length;

            // Garante intervalo mínimo de 5 minutos para catálogos grandes (>= 2.000 produtos)
            if (totalRead >= LARGE_CATALOG_THRESHOLD && currentSyncIntervalMs < LARGE_CATALOG_MIN_INTERVAL_MS) {
                currentSyncIntervalMs = LARGE_CATALOG_MIN_INTERVAL_MS;
                nextDelayMs = currentSyncIntervalMs;
                if (!hasLoggedLargeCatalogIntervalGuard) {
                    console.log(
                        `🛡️ [Proteção NFC-e / Catálogo Grande] Catálogo com ${totalRead} itens detectado: ` +
                        `intervalo mínimo ajustado automaticamente para 5 minutos (${LARGE_CATALOG_MIN_INTERVAL_MS / 1000}s).`
                    );
                    hasLoggedLargeCatalogIntervalGuard = true;
                }
            }

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
                    // No Delta Sync, envia APENAS produtos cujo estoque, preço, promoção ou nome mudaram
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

            nextDelayMs = currentSyncIntervalMs;
        } catch (error) {
            console.error(`❌ Erro durante a sincronização: ${error.message}`);
            console.log(`⚠️ Tentando novamente em ${RETRY_INTERVAL_MS / 60000} minutos...`);
            nextDelayMs = RETRY_INTERVAL_MS;
        } finally {
            isSyncRunning = false;
            setTimeout(loop, nextDelayMs);
        }
    }

    // Inicia os loops
    heartbeatLoop();
    if (enablePdvPreSale && typeof connector.insertPreSaleOrder === 'function') {
        console.log('🛒 Monitoramento de Pedidos para Pré-Venda do PDV ativo (ENABLE_PDV_PRESALE=true, a cada 5s).');
        orderPollLoop();
    } else {
        console.log('ℹ️ Modo Somente Leitura de Catálogo/Estoque/Preços ativo. Gravação de pedidos no PDV desativada por padrão.');
    }
    loop();
}

module.exports = { startAgent };
