const sql = require('mssql');
const { normalizeAndSanitizeSiagoldRecord } = require('../shared/priceNormalizer');
const { loadSyncCache, extractProductKey } = require('../shared/state');

sql.on('error', err => {
    console.error('Erro global na conexão MSSQL (InovaFarma):', err.message);
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
    // Códigos internos no InovaFarma cabem em INT (32-bit, geralmente <= 7 dígitos), enquanto EAN-8/13 possui 8 a 14 dígitos
    const num = Number(cleanCode);
    if (!Number.isSafeInteger(num) || num <= 0 || num > 2147483647) return true;
    if (cleanCode.length >= 10) return true;
    return false;
}

class InovaFarmaConnector {
    constructor(dbConfig = {}) {
        this.dbConfig = {
            user: dbConfig.user || 'sa',
            password: dbConfig.password,
            server: dbConfig.server || 'localhost',
            port: Number(dbConfig.port) || 1433,
            database: dbConfig.database || 'INOVAFARMA',
            connectionTimeout: 30000,
            requestTimeout: 60000,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
        this.viewName = dbConfig.viewName || 'VW_INTEGRACAO_FARMAFLOW';
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
        if (this.branchCode) {
            try {
                const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                const result = await request.query(`SELECT * FROM ${viewName} WHERE codigo_filial = @branchCode`);
                return result.recordset || [];
            } catch (branchErr) {
                // Fallback se a view não possuir codigo_filial
            }
        }

        const result = await pool.request().query(`SELECT * FROM ${viewName}`);
        return result.recordset || [];
    }

    /**
     * Lê os registros da View do InovaFarma sem depender de `data_ultima_alteracao > @lastSync`
     * (pois diversas Views usam GETDATE() como data_ultima_alteracao).
     * O Delta Sync real é calculado em memória e persistido em `farmaflow_sync_cache.json`.
     */
    async getChangedRecords(lastSyncDate, syncOptions = {}) {
        let pool;
        try {
            pool = await sql.connect(this.dbConfig);

            const syncCacheItems = syncOptions.syncCacheItems || loadSyncCache().items || {};

            const candidateViews = Array.from(new Set([
                this.viewName,
                'VW_INTEGRACAO_FARMAFLOW',
                'vw_FarmaFlow_Itens'
            ].filter(Boolean)));

            let rawRecords = [];
            let lastQueryError = null;
            let usedView = this.viewName;

            for (const candidateView of candidateViews) {
                try {
                    rawRecords = await this.queryViewRecords(pool, candidateView);
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

            if (!this._hasLoggedViewColumns && rawRecords.length > 0 && rawRecords[0]) {
                console.log(`[InovaFarma] Colunas detectadas na View (${usedView}): ${Object.keys(rawRecords[0]).join(', ')}`);
                this._hasLoggedViewColumns = true;
            }

            const sanitizedRecords = [];
            let skippedZeroStockOrInactiveCount = 0;
            let skippedZeroPriceCount = 0;

            for (const row of rawRecords) {
                const normalized = normalizeAndSanitizeSiagoldRecord(row);
                if (!normalized) {
                    skippedZeroPriceCount++;
                    continue;
                }

                const identityKey = extractProductKey(normalized);
                const hasPositiveStock = normalized.stock > 0 && normalized.active !== false;

                if (!hasPositiveStock) {
                    const cachedSig = identityKey ? syncCacheItems[identityKey] : null;
                    const wasPositiveInCache = Boolean(cachedSig && !String(cachedSig).startsWith('0|'));
                    const wasKnownActiveInMemory = Boolean(identityKey && this.knownActiveProductKeys.has(identityKey));

                    if (!wasPositiveInCache && !wasKnownActiveInMemory) {
                        skippedZeroStockOrInactiveCount++;
                        continue;
                    }

                    if (identityKey) {
                        this.knownActiveProductKeys.delete(identityKey);
                    }
                } else if (identityKey) {
                    this.knownActiveProductKeys.add(identityKey);
                }

                delete normalized._priceFallbackApplied;
                sanitizedRecords.push(normalized);
            }

            sanitizedRecords.totalRead = rawRecords.length;
            sanitizedRecords.usedView = usedView;
            sanitizedRecords.skippedZeroStockOrInactiveCount = skippedZeroStockOrInactiveCount;
            sanitizedRecords.skippedZeroPriceCount = skippedZeroPriceCount;

            return sanitizedRecords;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                } catch (err) {
                    console.error('Erro ao fechar conexão com InovaFarma:', err.message);
                }
            }
        }
    }

    /**
     * Resolve o CodigoProduto (INT) no SQL Server do InovaFarma a partir do código de barras (EAN)
     * caso o item no FarmaFlow não tenha código interno numérico ou esteja com o próprio EAN.
     */
    async resolveCodigoProdutoByEan(poolOrTx, rawEan) {
        const cleanEan = String(rawEan || '').replace(/\D/g, '').trim();
        if (!cleanEan) return null;

        const eanNoLeadingZeros = cleanEan.replace(/^0+/, '') || cleanEan;

        // 1. Tenta buscar nas tabelas nativas do InovaFarma (dbo.Produto_CodigoBarra / dbo.Produto)
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

        // 2. Fallback: busca na View de integração configurada (VW_INTEGRACAO_FARMAFLOW)
        try {
            const reqView = new sql.Request(poolOrTx);
            reqView.input('ean1', sql.VarChar(30), cleanEan);
            reqView.input('ean2', sql.VarChar(30), eanNoLeadingZeros);
            const viewRes = await reqView.query(`
                SELECT TOP 1 *
                FROM ${this.viewName} WITH (NOLOCK)
            `);
            if (viewRes?.recordset?.length > 0) {
                const sampleRow = viewRes.recordset[0];
                const cols = Object.keys(sampleRow);
                const eanCol = cols.find(c => /^(codigo_barras|cod_barras|codigobarra|ean|gtin|barra)$/i.test(c));
                const idCol = cols.find(c => /^(codigo_interno|cod_interno|codigoproduto|codigo_produto|id_produto|cod_prod|codigo|id)$/i.test(c));

                if (eanCol && idCol) {
                    const reqMatch = new sql.Request(poolOrTx);
                    reqMatch.input('ean1', sql.VarChar(30), cleanEan);
                    reqMatch.input('ean2', sql.VarChar(30), eanNoLeadingZeros);
                    const matchRes = await reqMatch.query(`
                        SELECT TOP 1 [${idCol}] AS CodigoProduto
                        FROM ${this.viewName} WITH (NOLOCK)
                        WHERE LTRIM(RTRIM(CAST([${eanCol}] AS VARCHAR(30)))) IN (@ean1, @ean2)
                    `);
                    const foundView = matchRes?.recordset?.[0]?.CodigoProduto;
                    if (foundView && Number.isInteger(Number(foundView)) && Number(foundView) > 0) {
                        return Number(foundView);
                    }
                }
            }
        } catch (err) {
            // Ignora erro na view se colunas diferirem
        }

        return null;
    }

    /**
     * Grava um pedido do FarmaFlow diretamente na Pré-Venda do InovaFarma (SQL Server):
     * - dbo.Orcamento (cabeçalho com saltos +10 e rowguid = NEWID())
     * - dbo.Orcamento_Produto (itens com saltos +10 e rowguid = NEWID())
     * - dbo.Orcamento_PV (vínculo de Pré-Venda na tela do caixa)
     * - dbo.Entrega (dados de entrega quando aplicável)
     */
    async insertPreSaleOrder(order) {
        let pool;
        let transaction;

        try {
            pool = await sql.connect(this.dbConfig);

            const rawItems = Array.isArray(order.items) ? order.items : [];
            if (rawItems.length === 0) {
                throw new Error('O pedido não possui itens para enviar à Pré-Venda do InovaFarma.');
            }

            // 1. Resolve e valida o CodigoProduto (INT) de cada item antes de abrir a transação com lock
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

                // Se mesmo assim o código salvo existir e o banco aceitar verificar diretamente em dbo.Produto
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
                        `Não foi possível localizar o CodigoProduto no SQL Server do InovaFarma para o item "${itemName}" ` +
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

            // 2. Calcula os totais do cabeçalho (somando a taxa de entrega dentro do TotalLiquido/TotalBruto conforme definido)
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

            // Passo 1, 2 e 3: Calcula novos IDs (+10), insere primeiro na tabela pai dbo.Lancamento e depois em dbo.Orcamento
            const headerSqlResult = await headerReq.query(`
                DECLARE @NovoCodigoLancamento BIGINT;
                DECLARE @NovoCodigoOrcamento BIGINT;
                DECLARE @BaseCodigoOrcamentoID BIGINT;
                DECLARE @NovoCodigoPV INT;
                DECLARE @StepPV INT = 1;
                DECLARE @CodigoFuncionarioFinal INT;
                DECLARE @CodigoUsuarioFinal INT = NULL;

                IF OBJECT_ID('dbo.Lancamento', 'U') IS NOT NULL
                BEGIN
                    SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                    FROM dbo.Lancamento WITH (UPDLOCK, HOLDLOCK);
                END
                ELSE
                BEGIN
                    SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                    FROM dbo.Orcamento WITH (UPDLOCK, HOLDLOCK);
                END

                SELECT @NovoCodigoOrcamento = ISNULL(MAX(CodigoOrcamento), 1) + 10
                FROM dbo.Orcamento WITH (UPDLOCK, HOLDLOCK);

                SELECT @BaseCodigoOrcamentoID = ISNULL(MAX(CodigoOrcamentoID), 1)
                FROM dbo.Orcamento_Produto WITH (UPDLOCK, HOLDLOCK);

                -- Verifica dinamicamente se CodigoPV cresce de +10 ou +1 na base da filial
                DECLARE @Pv1 INT = NULL, @Pv2 INT = NULL;
                SELECT TOP 1 @Pv1 = CodigoPV FROM dbo.Orcamento_PV WITH (UPDLOCK, HOLDLOCK) ORDER BY CodigoPV DESC;
                IF @Pv1 IS NOT NULL
                BEGIN
                    SELECT TOP 1 @Pv2 = CodigoPV FROM dbo.Orcamento_PV WHERE CodigoPV < @Pv1 ORDER BY CodigoPV DESC;
                    IF @Pv2 IS NOT NULL AND (@Pv1 - @Pv2) = 10
                        SET @StepPV = 10;
                END

                SET @NovoCodigoPV = ISNULL(@Pv1, 0) + @StepPV;

                -- Resolve CodigoFuncionario (Opção 2: configurado, ou último funcionário válido de Orcamento, ou NULL)
                SET @CodigoFuncionarioFinal = @ConfiguredFuncionario;
                IF @CodigoFuncionarioFinal IS NULL
                BEGIN
                    SELECT TOP 1 @CodigoFuncionarioFinal = CodigoFuncionario
                    FROM dbo.Orcamento
                    WHERE CodigoFuncionario IS NOT NULL AND CodigoFuncionario > 0
                    ORDER BY CodigoOrcamento DESC;
                END

                IF OBJECT_ID('dbo.Lancamento', 'U') IS NOT NULL
                BEGIN
                    SELECT TOP 1 @CodigoUsuarioFinal = CodigoUsuario
                    FROM dbo.Lancamento
                    WHERE CodigoUsuario IS NOT NULL AND CodigoUsuario > 0
                    ORDER BY CodigoLancamento DESC;

                    IF @CodigoUsuarioFinal IS NULL
                        SET @CodigoUsuarioFinal = 241;

                    INSERT INTO dbo.Lancamento (
                        CodigoLancamento,
                        CodigoEmpresa,
                        DataLancamento,
                        CodigoUsuario,
                        rowguid
                    ) VALUES (
                        @NovoCodigoLancamento,
                        1,
                        GETDATE(),
                        @CodigoUsuarioFinal,
                        NEWID()
                    );
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

                SELECT
                    @NovoCodigoOrcamento AS CodigoOrcamento,
                    @NovoCodigoLancamento AS CodigoLancamento,
                    @BaseCodigoOrcamentoID AS BaseCodigoOrcamentoID,
                    @NovoCodigoPV AS CodigoPV,
                    @CodigoFuncionarioFinal AS CodigoFuncionario,
                    @CodigoUsuarioFinal AS CodigoUsuario;
            `);

            const idsRow = headerSqlResult?.recordset?.[0];
            if (!idsRow || !idsRow.CodigoOrcamento) {
                throw new Error('Falha ao gerar CodigoOrcamento na tabela dbo.Orcamento.');
            }

            const novoCodigoOrcamento = Number(idsRow.CodigoOrcamento);
            const novoCodigoLancamento = Number(idsRow.CodigoLancamento);
            const novoCodigoPV = Number(idsRow.CodigoPV);
            const codigoFuncionarioFinal = idsRow.CodigoFuncionario || null;
            const codigoUsuarioFinal = idsRow.CodigoUsuario || 241;
            let currentCodigoOrcamentoID = Number(idsRow.BaseCodigoOrcamentoID);

            // Passo 4: Insere cada item em dbo.Orcamento_Produto somando +10 ao CodigoOrcamentoID
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

            // Passo 5: Insere em dbo.Orcamento_Venda e dbo.Orcamento_PV amarrando @NovoCodigoOrcamento
            try {
                const ovMetaReq = new sql.Request(transaction);
                const ovColsRes = await ovMetaReq.query(`
                    SELECT
                        c.name AS colName,
                        LOWER(t.name) AS typeName,
                        c.is_nullable AS isNullable,
                        c.is_identity AS isIdentity,
                        c.is_computed AS isComputed
                    FROM sys.columns c
                    JOIN sys.types t ON c.user_type_id = t.user_type_id
                    WHERE c.object_id = OBJECT_ID('dbo.Orcamento_Venda')
                    ORDER BY c.column_id ASC;
                `);
                const ovCols = ovColsRes?.recordset || [];
                if (ovCols.length > 0) {
                    let sampleRow = null;
                    try {
                        const sampleRes = await new sql.Request(transaction).query(`
                            SELECT TOP 1 * FROM dbo.Orcamento_Venda WITH (UPDLOCK, HOLDLOCK) ORDER BY 1 DESC
                        `);
                        sampleRow = sampleRes?.recordset?.[0] || null;
                    } catch (e) {}

                    const insertColNames = [];
                    const insertValExprs = [];
                    for (const col of ovCols) {
                        if (col.isIdentity || col.isComputed) continue;
                        const colName = col.colName;
                        const colLower = String(colName).toLowerCase();
                        const typeLower = String(col.typeName || '').toLowerCase();

                        if (colLower === 'codigoorcamento') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('@CodigoOrcamento');
                        } else if (colLower === 'codigolancamento') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('@CodigoLancamento');
                        } else if (colLower === 'codigopv') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('@CodigoPV');
                        } else if (colLower === 'rowguid' || typeLower === 'uniqueidentifier') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('NEWID()');
                        } else if (colLower === 'codigovenda' || colLower === 'codigoorcamentovenda' || colLower === 'codigoorcamento_venda') {
                            const sampleVal = sampleRow ? sampleRow[colName] : undefined;
                            if (col.isNullable && sampleVal === null) {
                                insertColNames.push(`[${colName}]`);
                                insertValExprs.push('NULL');
                            } else if (sampleVal === 0) {
                                insertColNames.push(`[${colName}]`);
                                insertValExprs.push('0');
                            } else {
                                insertColNames.push(`[${colName}]`);
                                insertValExprs.push(`ISNULL((SELECT MAX([${colName}]) FROM dbo.Orcamento_Venda WITH (UPDLOCK, HOLDLOCK)), 1) + 10`);
                            }
                        } else if (colLower === 'codigofuncionario' || colLower === 'codigovendedor') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('@CodigoFuncionario');
                        } else if (colLower === 'codigousuario') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('@CodigoUsuario');
                        } else if (colLower === 'codigoempresa' || colLower === 'codigofilial') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('1');
                        } else if (colLower === 'codigocliente') {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('0');
                        } else if (typeLower.includes('date') || typeLower.includes('time')) {
                            insertColNames.push(`[${colName}]`);
                            insertValExprs.push('GETDATE()');
                        } else if (!col.isNullable) {
                            insertColNames.push(`[${colName}]`);
                            if (typeLower.includes('char') || typeLower.includes('text')) {
                                insertValExprs.push("''");
                            } else {
                                insertValExprs.push('0');
                            }
                        }
                    }

                    if (insertColNames.length > 0) {
                        const ovInsertReq = new sql.Request(transaction);
                        ovInsertReq.input('CodigoOrcamento', sql.BigInt, novoCodigoOrcamento);
                        ovInsertReq.input('CodigoLancamento', sql.BigInt, novoCodigoLancamento);
                        ovInsertReq.input('CodigoPV', sql.Int, novoCodigoPV);
                        ovInsertReq.input('CodigoFuncionario', sql.Int, codigoFuncionarioFinal);
                        ovInsertReq.input('CodigoUsuario', sql.Int, codigoUsuarioFinal);

                        await ovInsertReq.query(`
                            INSERT INTO dbo.Orcamento_Venda (
                                ${insertColNames.join(', ')}
                            ) VALUES (
                                ${insertValExprs.join(', ')}
                            );
                        `);
                    }
                }
            } catch (ovErr) {
                console.warn('⚠️ Aviso ao inserir em dbo.Orcamento_Venda:', ovErr.message);
            }

            const pvInsertReq = new sql.Request(transaction);
            pvInsertReq.input('CodigoOrcamento', sql.BigInt, novoCodigoOrcamento);
            pvInsertReq.input('CodigoPV', sql.Int, novoCodigoPV);
            await pvInsertReq.query(`
                INSERT INTO dbo.Orcamento_PV (
                    CodigoOrcamento,
                    CodigoPV,
                    rowguid
                ) VALUES (
                    @CodigoOrcamento,
                    @CodigoPV,
                    NEWID()
                );
            `);

            // 6. Gravação condicional em dbo.Entrega (usando as colunas reais do InovaFarma)
            let novoCodigoEntrega = null;
            if (order.deliveryMode !== 'pickup' && enderecoRua) {
                try {
                    const historicoEntrega = truncateStr(
                        `${nomeCliente} | ${observacaoHeader}`,
                        100,
                        nomeCliente
                    );
                    const entregaReq = new sql.Request(transaction);
                    entregaReq.input('CodigoLancamento', sql.BigInt, novoCodigoLancamento);
                    entregaReq.input('Historico', sql.VarChar(100), historicoEntrega);
                    entregaReq.input('Endereco', sql.VarChar(50), truncateStr(enderecoRua, 50, 'ENDERECO DE ENTREGA'));
                    entregaReq.input('Numero', sql.VarChar(10), truncateStr(enderecoNum, 10, 'S/N'));
                    entregaReq.input('Complemento', sql.VarChar(20), truncateStr(enderecoComp, 20, ''));
                    entregaReq.input('Bairro', sql.VarChar(30), truncateStr(enderecoBairro, 30, 'CENTRO'));
                    entregaReq.input('CEP', sql.VarChar(9), truncateStr(cep, 9, ''));
                    entregaReq.input('Telefone', sql.VarChar(20), truncateStr(telefone, 20, ''));
                    entregaReq.input('Referencia', sql.VarChar(50), truncateStr(order.observation || '', 50, ''));

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
                                        CodigoLancamento,
                                        Historico,
                                        Status,
                                        Endereco,
                                        Numero,
                                        Complemento,
                                        Bairro,
                                        CodigoCidade,
                                        CEP,
                                        Telefone,
                                        Referencia,
                                        Eliminado,
                                        rowguid
                                    ) VALUES (
                                        @NovoCodigoEntrega,
                                        @CodigoLancamento,
                                        @Historico,
                                        0,
                                        @Endereco,
                                        @Numero,
                                        @Complemento,
                                        @Bairro,
                                        @CodigoCidadePadrao,
                                        @CEP,
                                        @Telefone,
                                        @Referencia,
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
                `✅ [PRÉ-VENDA INOVAFARMA] Pedido #${shortOrderId} inserido com sucesso! ` +
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
                    console.error('Erro ao fechar conexão MSSQL InovaFarma:', closeErr.message);
                }
            }
        }
    }
}

module.exports = InovaFarmaConnector;
