const sql = require('mssql');
const {
    parsePriceValue,
    parseStockValue,
    parseActiveStatus,
    getFieldIgnoreCase,
    extractBarcode,
    extractInternalCode,
    normalizeAndSanitizeSiagoldRecord
} = require('../shared/priceNormalizer');
const { loadSyncCache, extractProductKey } = require('../shared/state');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL (Siagold):', err.message);
});

function roundMoney(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function truncateStr(val, maxLen, fallback = '') {
    const s = String(val ?? fallback).trim();
    return s.length > maxLen ? s.substring(0, maxLen) : s;
}

function isLikelyBarcode(codeStr, eanStr) {
    const cleanCode = String(codeStr || '').trim();
    const cleanEan = String(eanStr || '').replace(/\D/g, '');
    if (!cleanCode) return true;
    if (!/^\d+$/.test(cleanCode)) return true;
    if (cleanEan && cleanCode === cleanEan && cleanCode.length >= 8) return true;
    const num = Number(cleanCode);
    if (!Number.isSafeInteger(num) || num <= 0 || num > 2147483647) return true;
    if (cleanCode.length >= 10) return true;
    return false;
}

function resolveRecordIdentityKey(record) {
    return extractProductKey(record);
}

class SiagoldConnector {
    constructor(dbConfig = {}) {
        this.dbConfig = {
            user: dbConfig.user || 'sa',
            password: dbConfig.password,
            server: dbConfig.server || 'localhost',
            port: Number(dbConfig.port) || 1433,
            database: dbConfig.database || 'SIAGOLD',
            connectionTimeout: 30000,
            requestTimeout: 60000,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
        this.viewName = dbConfig.viewName || 'vw_FarmaFlow_Itens';
        this.branchCode = dbConfig.branchCode || null;
        this.defaultFuncionarioId =
            dbConfig.defaultFuncionarioId ||
            dbConfig.codigoFuncionario ||
            process.env.DEFAULT_FUNCIONARIO_ID ||
            null;
        this.knownActiveProductKeys = new Set();
        this._hasLoggedViewColumns = false;
    }

    async queryViewRecords(pool, viewName) {
        // IMPORTANTE: Não filtrar por `WHERE data_ultima_alteracao > @lastSync` no SQL,
        // pois diversas views (como na Drogaria Macabú) usam `GETDATE()` na coluna `data_ultima_alteracao`,
        // o que fazia todas as linhas parecerem recém-alteradas a cada minuto.
        // A leitura direta da View + Delta Sync por Hash em memória/cache local (`farmaflow_sync_cache.json`)
        // garante precisão absoluta sem reenviar lotes desnecessários.
        if (this.branchCode) {
            try {
                const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                const result = await request.query(`SELECT * FROM ${viewName} WHERE codigo_filial = @branchCode`);
                return {
                    records: result.recordset || []
                };
            } catch (branchErr) {
                // Fallback caso a view não possua a coluna codigo_filial
            }
        }

        const result = await pool.request().query(`SELECT * FROM ${viewName}`);
        return {
            records: result.recordset || []
        };
    }

    async getChangedRecords(lastSyncDate, syncOptions = {}) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);

            const syncCacheItems = syncOptions.syncCacheItems || loadSyncCache().items || {};

            const candidateViews = Array.from(new Set([
                this.viewName,
                'vw_FarmaFlow_Itens',
                'VW_INTEGRACAO_FARMAFLOW'
            ].filter(Boolean)));

            let rawRecords = [];
            let lastQueryError = null;
            let usedView = this.viewName;

            for (const candidateView of candidateViews) {
                try {
                    const queryResult = await this.queryViewRecords(pool, candidateView);
                    rawRecords = queryResult.records;
                    usedView = candidateView;
                    lastQueryError = null;
                    break;
                } catch (err) {
                    lastQueryError = err;
                }
            }

            if (lastQueryError && rawRecords.length === 0) {
                throw lastQueryError;
            }

            // Log de Diagnóstico das Colunas apenas no 1º ciclo para não poluir o console a cada minuto
            if (!this._hasLoggedViewColumns && rawRecords.length > 0 && rawRecords[0]) {
                console.log(`[Siagold] Colunas detectadas na View (${usedView}): ${Object.keys(rawRecords[0]).join(', ')}`);
                this._hasLoggedViewColumns = true;
            }

            let fallbackCount = 0;
            let skippedZeroPriceCount = 0;
            let skippedZeroStockOrInactiveCount = 0;
            let zeroStockUpdatesAllowed = 0;
            const sanitizedRecords = [];

            for (const row of rawRecords) {
                const normalized = normalizeAndSanitizeSiagoldRecord(row);
                if (!normalized) {
                    skippedZeroPriceCount++;
                    continue;
                }

                const identityKey = resolveRecordIdentityKey(normalized);
                const hasPositiveStock = normalized.stock > 0 && normalized.active !== false;

                if (!hasPositiveStock) {
                    const cachedSig = identityKey ? syncCacheItems[identityKey] : null;
                    const wasPositiveInCache = Boolean(cachedSig && !String(cachedSig).startsWith('0|'));
                    const wasKnownActiveInMemory = Boolean(identityKey && this.knownActiveProductKeys.has(identityKey));

                    if (!wasPositiveInCache && !wasKnownActiveInMemory) {
                        skippedZeroStockOrInactiveCount++;
                        continue;
                    }

                    zeroStockUpdatesAllowed++;
                    if (identityKey) {
                        this.knownActiveProductKeys.delete(identityKey);
                    }
                } else if (identityKey) {
                    this.knownActiveProductKeys.add(identityKey);
                }

                if (normalized._priceFallbackApplied) {
                    fallbackCount++;
                }
                delete normalized._priceFallbackApplied;
                sanitizedRecords.push(normalized);
            }

            // Anexa metadados de leitura para o runner exibir o resumo exato de Delta Sync
            sanitizedRecords.totalRead = rawRecords.length;
            sanitizedRecords.usedView = usedView;
            sanitizedRecords.skippedZeroStockOrInactiveCount = skippedZeroStockOrInactiveCount;
            sanitizedRecords.skippedZeroPriceCount = skippedZeroPriceCount;
            sanitizedRecords.fallbackCount = fallbackCount;

            return sanitizedRecords;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (err) {
                    console.error('Erro ao fechar conexão com o banco (Siagold):', err.message);
                }
            }
        }
    }

    /**
     * Resolve o CodigoProduto (INT) no SQL Server a partir do código de barras (EAN)
     * quando o executável farmaflow-siagold.exe estiver conectado a uma base InovaFarma (ex: Drogaria Macabú).
     */
    async resolveCodigoProdutoByEan(poolOrTx, rawEan) {
        const cleanEan = String(rawEan || '').replace(/\D/g, '').trim();
        if (!cleanEan) return null;

        const eanNoLeadingZeros = cleanEan.replace(/^0+/, '') || cleanEan;

        // 1. Tenta buscar nas tabelas nativas (dbo.Produto_CodigoBarra / dbo.Produto)
        try {
            const reqNative = new sql.Request(poolOrTx);
            reqNative.input('ean1', sql.VarChar(30), cleanEan);
            reqNative.input('ean2', sql.VarChar(30), eanNoLeadingZeros);
            const nativeRes = await reqNative.query(`
                DECLARE @FoundCodigo INT = NULL;

                IF OBJECT_ID('dbo.Produto_CodigoBarra', 'U') IS NOT NULL
                BEGIN
                    SELECT TOP 1 @FoundCodigo = CodigoProduto
                    FROM dbo.Produto_CodigoBarra WITH (NOLOCK)
                    WHERE LTRIM(RTRIM(CodigoBarra)) IN (@ean1, @ean2);
                END

                IF @FoundCodigo IS NULL AND OBJECT_ID('dbo.Produto', 'U') IS NOT NULL
                BEGIN
                    SELECT TOP 1 @FoundCodigo = CodigoProduto
                    FROM dbo.Produto WITH (NOLOCK)
                    WHERE LTRIM(RTRIM(CodigoBarra)) IN (@ean1, @ean2);
                END

                SELECT @FoundCodigo AS CodigoProduto;
            `);
            const foundNative = nativeRes?.recordset?.[0]?.CodigoProduto;
            if (foundNative && Number.isInteger(Number(foundNative)) && Number(foundNative) > 0) {
                return Number(foundNative);
            }
        } catch (err) {
            // Prossegue para busca na View
        }

        // 2. Fallback: busca na View de integração configurada (vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW)
        const candidateViews = Array.from(new Set([
            this.viewName,
            'vw_FarmaFlow_Itens',
            'VW_INTEGRACAO_FARMAFLOW'
        ].filter(Boolean)));

        for (const candidateView of candidateViews) {
            try {
                const reqView = new sql.Request(poolOrTx);
                const viewRes = await reqView.query(`SELECT TOP 1 * FROM ${candidateView} WITH (NOLOCK)`);
                if (viewRes?.recordset?.length > 0) {
                    const sampleRow = viewRes.recordset[0];
                    const cols = Object.keys(sampleRow);
                    const eanCol = cols.find(c => /^(codigo_barras|cod_barras|codigobarra|ean|gtin|barra|cod_barra)$/i.test(c));
                    const idCol = cols.find(c => /^(codigo_interno|cod_interno|cod_item|codigo_item|codigoproduto|codigo_produto|id_produto|cod_prod|cd_produto|codigo|id)$/i.test(c));

                    if (eanCol && idCol) {
                        const reqMatch = new sql.Request(poolOrTx);
                        reqMatch.input('ean1', sql.VarChar(30), cleanEan);
                        reqMatch.input('ean2', sql.VarChar(30), eanNoLeadingZeros);
                        const matchRes = await reqMatch.query(`
                            SELECT TOP 1 [${idCol}] AS CodigoProduto
                            FROM ${candidateView} WITH (NOLOCK)
                            WHERE LTRIM(RTRIM(CAST([${eanCol}] AS VARCHAR(30)))) IN (@ean1, @ean2)
                        `);
                        const foundView = matchRes?.recordset?.[0]?.CodigoProduto;
                        if (foundView && Number.isInteger(Number(foundView)) && Number(foundView) > 0) {
                            return Number(foundView);
                        }
                    }
                }
            } catch (err) {
                // Ignora se a view candidata não existir
            }
        }

        return null;
    }

    /**
     * Grava um pedido do FarmaFlow diretamente na Pré-Venda do PDV (dbo.Orcamento, dbo.Orcamento_Produto, dbo.Orcamento_PV, dbo.Entrega).
     * Permite que farmácias rodando farmaflow-siagold.exe em banco SQL Server InovaFarma (ex: Drogaria Macabú)
     * utilizem o botão "Enviar para o PDV" sem precisar trocar de executável.
     */
    async insertPreSaleOrder(order) {
        let pool;
        let transaction;

        try {
            pool = await sql.connect(this.dbConfig);

            // Verifica se a tabela dbo.Orcamento existe neste banco SQL Server
            const tableCheck = await pool.request().query(`
                SELECT
                    OBJECT_ID('dbo.Orcamento', 'U') AS HasOrcamento,
                    OBJECT_ID('dbo.Orcamento_Produto', 'U') AS HasOrcamentoProduto,
                    OBJECT_ID('dbo.Orcamento_PV', 'U') AS HasOrcamentoPV
            `);
            const checkRow = tableCheck?.recordset?.[0] || {};
            if (!checkRow.HasOrcamento || !checkRow.HasOrcamentoProduto || !checkRow.HasOrcamentoPV) {
                throw new Error(
                    'As tabelas de Pré-Venda (dbo.Orcamento, dbo.Orcamento_Produto, dbo.Orcamento_PV) não foram encontradas neste banco SQL Server.'
                );
            }

            const rawItems = Array.isArray(order.items) ? order.items : [];
            if (rawItems.length === 0) {
                throw new Error('O pedido não possui itens para enviar à Pré-Venda do PDV.');
            }

            // 1. Resolve e valida o CodigoProduto (INT) de cada item
            const preparedItems = [];
            for (let i = 0; i < rawItems.length; i++) {
                const it = rawItems[i];
                const rawCode =
                    it.codigoProduto ??
                    it.internalCode ??
                    it.internal_code ??
                    it.erpProductId ??
                    it.erp_product_id ??
                    '';
                const rawEan =
                    it.ean ??
                    it.barcode ??
                    it.codigo_barras ??
                    '';
                const itemName = String(it.nome || it.name || `Item #${i + 1}`).trim();

                let resolvedCodigoProduto = null;
                if (!isLikelyBarcode(rawCode, rawEan)) {
                    resolvedCodigoProduto = parseInt(String(rawCode).trim(), 10);
                } else {
                    resolvedCodigoProduto = await this.resolveCodigoProdutoByEan(pool, rawEan || rawCode);
                }

                if (!resolvedCodigoProduto && /^\d+$/.test(String(rawCode).trim())) {
                    const numCandidate = parseInt(String(rawCode).trim(), 10);
                    if (numCandidate > 0 && numCandidate <= 2147483647) {
                        try {
                            const checkReq = pool.request();
                            checkReq.input('codProd', sql.Int, numCandidate);
                            const checkRes = await checkReq.query(`
                                SELECT TOP 1 CodigoProduto
                                FROM dbo.Produto WITH (NOLOCK)
                                WHERE CodigoProduto = @codProd
                            `);
                            if (checkRes?.recordset?.[0]?.CodigoProduto) {
                                resolvedCodigoProduto = Number(checkRes.recordset[0].CodigoProduto);
                            }
                        } catch (e) {}
                    }
                }

                if (!resolvedCodigoProduto || !Number.isInteger(resolvedCodigoProduto) || resolvedCodigoProduto <= 0) {
                    throw new Error(
                        `Não foi possível localizar o CodigoProduto no SQL Server para o item "${itemName}" ` +
                        `(Cód. Interno: "${rawCode || 'vazio'}", EAN: "${rawEan || 'vazio'}").`
                    );
                }

                const quantidade = Math.max(1, Number(it.quantidade ?? it.quantity ?? 1));
                const precoLiquidoUnit = roundMoney(it.precoUnitario ?? it.price ?? it.unit_price ?? 0);
                const precoBrutoUnit = roundMoney(
                    it.precoOriginal && Number(it.precoOriginal) > precoLiquidoUnit
                        ? Number(it.precoOriginal)
                        : (it.originalPrice && Number(it.originalPrice) > precoLiquidoUnit
                            ? Number(it.originalPrice)
                            : precoLiquidoUnit + roundMoney(it.descontoUnitario ?? 0))
                );

                const itemTotalBruto = roundMoney(precoBrutoUnit * quantidade);
                const itemTotalLiquido = roundMoney(precoLiquidoUnit * quantidade);
                const itemTotalDesconto = roundMoney(Math.max(0, itemTotalBruto - itemTotalLiquido));
                const unidade = truncateStr(it.unidadeMedida || it.unitMeasure || 'UN', 5, 'UN');

                preparedItems.push({
                    codigoProduto: resolvedCodigoProduto,
                    nome: itemName,
                    quantidade,
                    preco: precoLiquidoUnit,
                    totalBruto: itemTotalBruto,
                    totalDesconto: itemTotalDesconto,
                    totalLiquido: itemTotalLiquido,
                    unidade
                });
            }

            // 2. Calcula os totais do cabeçalho (somando a taxa de entrega dentro do TotalLiquido/TotalBruto)
            const taxaEntrega = roundMoney(
                order.taxaEntrega ?? order.deliveryFee ?? order.delivery_fee ?? 0
            );
            const descontoCupom = roundMoney(
                order.descontoGlobal ?? order.couponDiscount ?? order.coupon_discount ?? 0
            );

            const somaItensBruto = roundMoney(
                preparedItems.reduce((acc, item) => acc + item.totalBruto, 0)
            );
            const somaItensDesconto = roundMoney(
                preparedItems.reduce((acc, item) => acc + item.totalDesconto, 0)
            );

            const headerTotalBruto = roundMoney(somaItensBruto + taxaEntrega);
            const headerTotalDesconto = roundMoney(somaItensDesconto + descontoCupom);
            const headerTotalLiquido = roundMoney(Math.max(0, headerTotalBruto - headerTotalDesconto));

            // 3. Monta NomeCliente (varchar 100) e Observacao (varchar 200)
            const customer = order.customer || order.cliente || {};
            const nomeCliente = truncateStr(
                customer.name || customer.nome || order.customerName || 'CLIENTE FARMAFLOW',
                100,
                'CLIENTE FARMAFLOW'
            );
            const telefone = truncateStr(
                String(customer.phone || customer.telefone || '').replace(/\s+/g, ' '),
                20,
                ''
            );
            const formaPagamento = String(
                order.paymentMethod || customer.paymentMethod || order.formaPagamento || 'PIX'
            ).trim();
            const trocoPara = customer.changeFor || order.changeFor || '';
            const enderecoRua = String(
                customer.address || customer.endereco?.logradouro || ''
            ).trim();
            const enderecoNum = String(
                customer.addressNumber || customer.endereco?.numero || 'S/N'
            ).trim();
            const enderecoBairro = String(
                customer.neighborhood || customer.endereco?.bairro || ''
            ).trim();
            const enderecoComp = String(
                customer.complement || customer.endereco?.complemento || ''
            ).trim();
            const cep = truncateStr(
                String(customer.cep || customer.endereco?.cep || '').replace(/\D/g, ''),
                9,
                ''
            );

            const shortOrderId = String(order.id || '').slice(-6).toUpperCase();
            const obsParts = [`FF #${shortOrderId}`];
            if (telefone) obsParts.push(`Tel:${telefone}`);
            obsParts.push(`Pag:${formaPagamento}${trocoPara ? `(Troco p/ ${trocoPara})` : ''}`);
            if (taxaEntrega > 0) obsParts.push(`TaxaEnt:R$${taxaEntrega.toFixed(2)}`);
            if (order.observation) obsParts.push(`Obs:${String(order.observation).trim()}`);
            if (enderecoRua) {
                obsParts.push(`End:${enderecoRua},${enderecoNum}${enderecoBairro ? `-${enderecoBairro}` : ''}`);
            }
            const observacaoHeader = truncateStr(obsParts.join(' | '), 200, `FF #${shortOrderId}`);

            // 4. Inicia a transação SQL Server com UPDLOCK, HOLDLOCK
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

            const headerReq = new sql.Request(transaction);
            const configuredFuncId =
                this.defaultFuncionarioId && !isNaN(Number(this.defaultFuncionarioId)) && Number(this.defaultFuncionarioId) > 0
                    ? Number(this.defaultFuncionarioId)
                    : null;

            headerReq.input('ConfiguredFuncionario', sql.Int, configuredFuncId);
            headerReq.input('TotalBruto', sql.Money, headerTotalBruto);
            headerReq.input('TotalDesconto', sql.Money, headerTotalDesconto);
            headerReq.input('TotalLiquido', sql.Money, headerTotalLiquido);
            headerReq.input('Observacao', sql.VarChar(200), observacaoHeader);
            headerReq.input('NomeCliente', sql.VarChar(100), nomeCliente);

            const headerSqlResult = await headerReq.query(`
                DECLARE @NovoCodigoOrcamento BIGINT;
                DECLARE @NovoCodigoLancamento BIGINT;
                DECLARE @BaseCodigoOrcamentoID BIGINT;
                DECLARE @NovoCodigoPV INT;
                DECLARE @StepPV INT = 1;
                DECLARE @CodigoFuncionarioFinal INT;

                SELECT @NovoCodigoOrcamento = ISNULL(MAX(CodigoOrcamento), 1) + 10
                FROM dbo.Orcamento WITH (UPDLOCK, HOLDLOCK);

                SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                FROM dbo.Orcamento WITH (UPDLOCK, HOLDLOCK);

                SELECT @BaseCodigoOrcamentoID = ISNULL(MAX(CodigoOrcamentoID), 1)
                FROM dbo.Orcamento_Produto WITH (UPDLOCK, HOLDLOCK);

                DECLARE @Pv1 INT = NULL, @Pv2 INT = NULL;
                SELECT TOP 1 @Pv1 = CodigoPV FROM dbo.Orcamento_PV WITH (UPDLOCK, HOLDLOCK) ORDER BY CodigoPV DESC;
                IF @Pv1 IS NOT NULL
                BEGIN
                    SELECT TOP 1 @Pv2 = CodigoPV FROM dbo.Orcamento_PV WHERE CodigoPV < @Pv1 ORDER BY CodigoPV DESC;
                    IF @Pv2 IS NOT NULL AND (@Pv1 - @Pv2) = 10
                        SET @StepPV = 10;
                END

                SET @NovoCodigoPV = ISNULL(@Pv1, 0) + @StepPV;

                SET @CodigoFuncionarioFinal = @ConfiguredFuncionario;
                IF @CodigoFuncionarioFinal IS NULL
                BEGIN
                    SELECT TOP 1 @CodigoFuncionarioFinal = CodigoFuncionario
                    FROM dbo.Orcamento
                    WHERE CodigoFuncionario IS NOT NULL AND CodigoFuncionario > 0
                    ORDER BY CodigoOrcamento DESC;
                END

                INSERT INTO dbo.Orcamento (
                    CodigoOrcamento,
                    CodigoCliente,
                    CodigoLancamento,
                    TotalBruto,
                    TotalDesconto,
                    TotalLiquido,
                    Observacao,
                    CodigoFuncionario,
                    Eliminado,
                    NomeCliente,
                    rowguid,
                    DataUltimaAtualizacao
                ) VALUES (
                    @NovoCodigoOrcamento,
                    0,
                    @NovoCodigoLancamento,
                    @TotalBruto,
                    @TotalDesconto,
                    @TotalLiquido,
                    @Observacao,
                    @CodigoFuncionarioFinal,
                    0,
                    @NomeCliente,
                    NEWID(),
                    GETDATE()
                );

                INSERT INTO dbo.Orcamento_PV (
                    CodigoOrcamento,
                    CodigoPV,
                    rowguid
                ) VALUES (
                    @NovoCodigoOrcamento,
                    @NovoCodigoPV,
                    NEWID()
                );

                SELECT
                    @NovoCodigoOrcamento AS CodigoOrcamento,
                    @NovoCodigoLancamento AS CodigoLancamento,
                    @BaseCodigoOrcamentoID AS BaseCodigoOrcamentoID,
                    @NovoCodigoPV AS CodigoPV,
                    @CodigoFuncionarioFinal AS CodigoFuncionario;
            `);

            const idsRow = headerSqlResult?.recordset?.[0];
            if (!idsRow || !idsRow.CodigoOrcamento) {
                throw new Error('Falha ao gerar CodigoOrcamento na tabela dbo.Orcamento.');
            }

            const novoCodigoOrcamento = Number(idsRow.CodigoOrcamento);
            const novoCodigoLancamento = Number(idsRow.CodigoLancamento);
            const novoCodigoPV = Number(idsRow.CodigoPV);
            let currentCodigoOrcamentoID = Number(idsRow.BaseCodigoOrcamentoID);

            // 5. Insere cada item em dbo.Orcamento_Produto somando +10 ao CodigoOrcamentoID
            for (const item of preparedItems) {
                currentCodigoOrcamentoID += 10;
                const itemReq = new sql.Request(transaction);
                itemReq.input('CodigoOrcamentoID', sql.BigInt, currentCodigoOrcamentoID);
                itemReq.input('CodigoOrcamento', sql.BigInt, novoCodigoOrcamento);
                itemReq.input('CodigoProduto', sql.Int, item.codigoProduto);
                itemReq.input('Quantidade', sql.Numeric(18, 4), item.quantidade);
                itemReq.input('Preco', sql.Money, item.preco);
                itemReq.input('TotalBruto', sql.Money, item.totalBruto);
                itemReq.input('TotalDesconto', sql.Money, item.totalDesconto);
                itemReq.input('TotalLiquido', sql.Money, item.totalLiquido);
                itemReq.input('Unidade', sql.VarChar(5), item.unidade);

                await itemReq.query(`
                    INSERT INTO dbo.Orcamento_Produto (
                        CodigoOrcamentoID,
                        CodigoOrcamento,
                        CodigoProduto,
                        Quantidade,
                        Preco,
                        TotalBruto,
                        TotalDesconto,
                        TotalLiquido,
                        Fracao,
                        Unidade,
                        rowguid,
                        CodigoProdutoKit
                    ) VALUES (
                        @CodigoOrcamentoID,
                        @CodigoOrcamento,
                        @CodigoProduto,
                        @Quantidade,
                        @Preco,
                        @TotalBruto,
                        @TotalDesconto,
                        @TotalLiquido,
                        1,
                        @Unidade,
                        NEWID(),
                        NULL
                    );
                `);
            }

            // 6. Gravação condicional em dbo.Entrega
            let novoCodigoEntrega = null;
            if (order.deliveryMode !== 'pickup' && enderecoRua) {
                try {
                    const entregaReq = new sql.Request(transaction);
                    entregaReq.input('CodigoOrcamento', sql.BigInt, novoCodigoOrcamento);
                    entregaReq.input('Endereco', sql.VarChar(50), truncateStr(enderecoRua, 50, 'ENDERECO DE ENTREGA'));
                    entregaReq.input('Numero', sql.VarChar(10), truncateStr(enderecoNum, 10, 'S/N'));
                    entregaReq.input('Complemento', sql.VarChar(20), truncateStr(enderecoComp, 20, ''));
                    entregaReq.input('Bairro', sql.VarChar(30), truncateStr(enderecoBairro, 30, 'CENTRO'));
                    entregaReq.input('CEP', sql.VarChar(9), truncateStr(cep, 9, ''));
                    entregaReq.input('Telefone', sql.VarChar(20), truncateStr(telefone, 20, ''));
                    entregaReq.input('Referencia', sql.VarChar(50), truncateStr(order.observation || '', 50, ''));
                    entregaReq.input('Taxa', sql.Money, taxaEntrega);

                    const entregaRes = await entregaReq.query(`
                        DECLARE @CodigoCidadePadrao INT = NULL;
                        DECLARE @NovoCodigoEntrega BIGINT = NULL;

                        IF OBJECT_ID('dbo.Entrega', 'U') IS NOT NULL
                        BEGIN
                            BEGIN TRY
                                SELECT TOP 1 @CodigoCidadePadrao = CodigoCidade
                                FROM dbo.Entrega
                                WHERE CodigoCidade IS NOT NULL
                                ORDER BY CodigoEntrega DESC;

                                IF @CodigoCidadePadrao IS NULL AND OBJECT_ID('dbo.Cidade', 'U') IS NOT NULL
                                BEGIN
                                    SELECT TOP 1 @CodigoCidadePadrao = CodigoCidade
                                    FROM dbo.Cidade;
                                END

                                IF @CodigoCidadePadrao IS NOT NULL
                                BEGIN
                                    SELECT @NovoCodigoEntrega = ISNULL(MAX(CodigoEntrega), 1) + 10
                                    FROM dbo.Entrega WITH (UPDLOCK, HOLDLOCK);

                                    INSERT INTO dbo.Entrega (
                                        CodigoEntrega,
                                        CodigoOrcamento,
                                        CodigoCliente,
                                        Endereco,
                                        Numero,
                                        Complemento,
                                        Bairro,
                                        CodigoCidade,
                                        CEP,
                                        Telefone,
                                        Referencia,
                                        DataHora,
                                        [DataHora Saida],
                                        Taxa,
                                        Status,
                                        Eliminado,
                                        rowguid
                                    ) VALUES (
                                        @NovoCodigoEntrega,
                                        @CodigoOrcamento,
                                        0,
                                        @Endereco,
                                        @Numero,
                                        @Complemento,
                                        @Bairro,
                                        @CodigoCidadePadrao,
                                        @CEP,
                                        @Telefone,
                                        @Referencia,
                                        GETDATE(),
                                        GETDATE(),
                                        @Taxa,
                                        0,
                                        0,
                                        NEWID()
                                    );
                                END
                            END TRY
                            BEGIN CATCH
                                SET @NovoCodigoEntrega = NULL;
                            END CATCH
                        END

                        SELECT @NovoCodigoEntrega AS CodigoEntrega;
                    `);
                    novoCodigoEntrega = entregaRes?.recordset?.[0]?.CodigoEntrega || null;
                } catch (entregaErr) {
                    console.warn('⚠️ Aviso: Não foi possível gravar registro complementar em dbo.Entrega:', entregaErr.message);
                }
            }

            await transaction.commit();

            console.log(
                `✅ [PRÉ-VENDA PDV] Pedido #${shortOrderId} inserido com sucesso! ` +
                `CodigoPV: #${novoCodigoPV} | CodigoOrcamento: #${novoCodigoOrcamento} | Itens: ${preparedItems.length}`
            );

            return {
                success: true,
                codigoOrcamento: novoCodigoOrcamento,
                codigoLancamento: novoCodigoLancamento,
                codigoPV: novoCodigoPV,
                codigoEntrega: novoCodigoEntrega,
                codigoFuncionario: idsRow.CodigoFuncionario || null,
                totalLiquido: headerTotalLiquido,
                itemsCount: preparedItems.length
            };
        } catch (err) {
            if (transaction) {
                try {
                    await transaction.rollback();
                } catch (rbErr) {
                    console.error('Erro ao realizar rollback da transação de Pré-Venda:', rbErr.message);
                }
            }
            throw err;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (closeErr) {
                    console.error('Erro ao fechar conexão MSSQL (Siagold):', closeErr.message);
                }
            }
        }
    }
}

SiagoldConnector.normalizeAndSanitizeSiagoldRecord = normalizeAndSanitizeSiagoldRecord;
SiagoldConnector.parsePriceValue = parsePriceValue;
SiagoldConnector.parseStockValue = parseStockValue;
SiagoldConnector.parseActiveStatus = parseActiveStatus;
SiagoldConnector.extractBarcode = extractBarcode;
SiagoldConnector.extractInternalCode = extractInternalCode;

module.exports = SiagoldConnector;
