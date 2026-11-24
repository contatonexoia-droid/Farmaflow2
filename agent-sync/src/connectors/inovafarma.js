const sql = require('mssql');
const { normalizeAndSanitizeSiagoldRecord } = require('../shared/priceNormalizer');
const { loadSyncCache, extractProductKey } = require('../shared/state');
const {
    resolveIgnorePromotionCampaignsFlag,
    applyInovaFarmaStrictPromotionRules
} = require('../shared/inovafarmaPromoResolver');

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
        this.rawDbConfig = dbConfig;
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
        this.ignorePromotionCampaigns = resolveIgnorePromotionCampaignsFlag(dbConfig);
        this.enablePdvPreSale =
            String(process.env.ENABLE_PDV_PRESALE ?? dbConfig.enablePdvPreSale ?? 'false')
                .trim()
                .toLowerCase() === 'true';
        this.defaultFuncionarioId =
            dbConfig.defaultFuncionarioId ||
            dbConfig.codigoFuncionario ||
            process.env.DEFAULT_FUNCIONARIO_ID ||
            null;
        this.knownActiveProductKeys = new Set();
        this._hasLoggedViewColumns = false;
        this._cachedInovaPromoSchema = null;
        this._hasLoggedPromoRuleSummary = false;
        this._hasLoggedInovaSchemaDiag = false;
    }

    async queryViewRecords(pool, viewName) {
        if (this.branchCode) {
            try {
                const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                const result = await request.query(`
                    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                    SET NOCOUNT ON;
                    SELECT * FROM ${viewName} WITH (NOLOCK) WHERE codigo_filial = @branchCode;
                `);
                return result.recordset || [];
            } catch (branchErr) {
                try {
                    const request = pool.request().input('branchCode', sql.VarChar, String(this.branchCode));
                    const result = await request.query(`
                        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                        SET NOCOUNT ON;
                        SELECT * FROM ${viewName} WHERE codigo_filial = @branchCode;
                    `);
                    return result.recordset || [];
                } catch (_) {
                    // Fallback se a view não possuir codigo_filial
                }
            }
        }

        try {
            const result = await pool.request().query(`
                SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                SET NOCOUNT ON;
                SELECT * FROM ${viewName} WITH (NOLOCK);
            `);
            return result.recordset || [];
        } catch (_) {
            const result = await pool.request().query(`
                SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                SET NOCOUNT ON;
                SELECT * FROM ${viewName};
            `);
            return result.recordset || [];
        }
    }

    /**
     * Lê os registros da View do InovaFarma sem depender de `data_ultima_alteracao > @lastSync`
     * (pois diversas Views usam GETDATE() como data_ultima_alteracao).
     * Em seguida, valida estritamente as campanhas de promoção na tabela nativa do InovaFarma
     * (data de vigência + dia da semana atual via INFORMATION_SCHEMA.COLUMNS), usando o PREÇO PROM.
     * da aba Estoque caso nenhuma campanha seja válida para hoje (ou quando ignorePromotionCampaigns estiver ativo).
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

            // Validação estrita de promoções por data + dia da semana atual (ou usar apenas Preço Prom. do produto)
            await applyInovaFarmaStrictPromotionRules(pool, rawRecords, {
                connectorInstance: this,
                dbConfig: this.rawDbConfig,
                branchCode: this.branchCode,
                ignorePromotionCampaigns:
                    typeof syncOptions.ignorePromotionCampaigns === 'boolean'
                        ? syncOptions.ignorePromotionCampaigns
                        : this.ignorePromotionCampaigns
            });

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
                SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                SET NOCOUNT ON;
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
                SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                SET NOCOUNT ON;
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
                        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                        SET NOCOUNT ON;
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
     * Grava um pedido do FarmaFlow diretamente na Pré-Venda do InovaFarma (SQL Server).
     * IMPORTANTE: Desativado por padrão (somente leitura). Exige opt-in explícito (enablePdvPreSale = true / ENABLE_PDV_PRESALE=true).
     */
    async insertPreSaleOrder(order) {
        const isPreSaleExplicitlyEnabled =
            Boolean(this.enablePdvPreSale) ||
            String(process.env.ENABLE_PDV_PRESALE || '').trim().toLowerCase() === 'true';

        if (!isPreSaleExplicitlyEnabled) {
            throw new Error(
                'Modo Somente Leitura ativo por padrão (ENABLE_PDV_PRESALE desativado). Nenhuma gravação foi realizada no SQL Server do PDV.'
            );
        }

        let pool;
        let transaction;

        try {
            pool = await sql.connect(this.dbConfig);

            const rawItems = Array.isArray(order.items) ? order.items : [];
            if (rawItems.length === 0) {
                throw new Error('O pedido não possui itens para enviar à Pré-Venda do InovaFarma.');
            }

            // 1. Resolve e valida o CodigoProduto (INT) e metadados (PrecoCusto, Unidade, CodigoGrupoInventario) de cada item
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

                // Busca PrecoCusto, Unidade e CodigoGrupoInventario em dbo.Produto
                let precoCustoProd = 0;
                let unidadeProd = truncateStr(it.unidadeMedida || it.unitMeasure || 'UN', 5, 'UN');
                let codigoGrupoInventarioProd = null;

                try {
                    const prodMetaReq = pool.request();
                    prodMetaReq.input('codProd', sql.Int, resolvedCodigoProduto);
                    const prodMetaRes = await prodMetaReq.query(`
                        DECLARE @PrecoCusto MONEY = 0;
                        DECLARE @UnidadeProd VARCHAR(5) = 'UN';
                        DECLARE @CodGrupoInv INT = NULL;

                        IF OBJECT_ID('dbo.Produto', 'U') IS NOT NULL
                        BEGIN
                            IF COL_LENGTH('dbo.Produto', 'PrecoCusto') IS NOT NULL
                            BEGIN
                                EXEC sp_executesql
                                    N'SELECT TOP 1 @pCusto = ISNULL(PrecoCusto, 0) FROM dbo.Produto WITH (NOLOCK) WHERE CodigoProduto = @pCod',
                                    N'@pCod INT, @pCusto MONEY OUTPUT',
                                    @pCod = @codProd,
                                    @pCusto = @PrecoCusto OUTPUT;
                            END

                            IF COL_LENGTH('dbo.Produto', 'Unidade') IS NOT NULL
                            BEGIN
                                EXEC sp_executesql
                                    N'SELECT TOP 1 @pUnid = LEFT(ISNULL(LTRIM(RTRIM(Unidade)), ''UN''), 5) FROM dbo.Produto WITH (NOLOCK) WHERE CodigoProduto = @pCod',
                                    N'@pCod INT, @pUnid VARCHAR(5) OUTPUT',
                                    @pCod = @codProd,
                                    @pUnid = @UnidadeProd OUTPUT;
                            END

                            IF COL_LENGTH('dbo.Produto', 'CodigoGrupoInventario') IS NOT NULL
                            BEGIN
                                EXEC sp_executesql
                                    N'SELECT TOP 1 @pGrupo = CodigoGrupoInventario FROM dbo.Produto WITH (NOLOCK) WHERE CodigoProduto = @pCod',
                                    N'@pCod INT, @pGrupo INT OUTPUT',
                                    @pCod = @codProd,
                                    @pGrupo = @CodGrupoInv OUTPUT;
                            END
                        END

                        SELECT
                            @PrecoCusto AS PrecoCusto,
                            @UnidadeProd AS Unidade,
                            @CodGrupoInv AS CodigoGrupoInventario;
                    `);
                    const metaRow = prodMetaRes?.recordset?.[0];
                    if (metaRow) {
                        precoCustoProd = roundMoney(metaRow.PrecoCusto ?? 0);
                        if (metaRow.Unidade && String(metaRow.Unidade).trim()) {
                            unidadeProd = truncateStr(metaRow.Unidade, 5, 'UN');
                        }
                        if (metaRow.CodigoGrupoInventario !== null && metaRow.CodigoGrupoInventario !== undefined) {
                            codigoGrupoInventarioProd = Number(metaRow.CodigoGrupoInventario);
                        }
                    }
                } catch (metaErr) {
                    // Fallback seguro
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
                const descontoUnit = roundMoney(Math.max(0, precoBrutoUnit - precoLiquidoUnit));

                const itemTotalBruto = roundMoney(precoBrutoUnit * quantidade);
                const itemTotalLiquido = roundMoney(precoLiquidoUnit * quantidade);
                const itemTotalDesconto = roundMoney(Math.max(0, itemTotalBruto - itemTotalLiquido));

                preparedItems.push({
                    codigoProduto: resolvedCodigoProduto,
                    nome: itemName,
                    quantidade,
                    preco: precoLiquidoUnit,
                    precoBrutoUnit,
                    descontoUnit,
                    precoCusto: precoCustoProd,
                    codigoGrupoInventario: codigoGrupoInventarioProd,
                    totalBruto: itemTotalBruto,
                    totalDesconto: itemTotalDesconto,
                    totalLiquido: itemTotalLiquido,
                    unidade: unidadeProd || 'UN'
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

            // 4. Consulta metadados reais das colunas de dbo.Lancamento, dbo.Venda e dbo.Venda_Produto
            const getTableColumnsMeta = async (fullTableName) => {
                try {
                    const colReq = new sql.Request(pool);
                    colReq.input('TableName', sql.NVarChar(128), fullTableName);
                    const colRes = await colReq.query(`
                        SELECT
                            c.name,
                            LOWER(t.name) AS type_name,
                            c.is_nullable,
                            c.default_object_id
                        FROM sys.columns c
                        INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
                        WHERE c.object_id = OBJECT_ID(@TableName)
                          AND c.is_identity = 0
                          AND c.is_computed = 0
                          AND LOWER(t.name) NOT IN ('timestamp', 'rowversion')
                        ORDER BY c.column_id ASC
                    `);
                    return colRes?.recordset || [];
                } catch (_) {
                    return [];
                }
            };

            const getNotNullFallbackExpr = (typeName) => {
                const t = String(typeName || '').toLowerCase();
                if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'money', 'smallmoney', 'float', 'real', 'bit'].includes(t)) {
                    return '0';
                }
                if (['varchar', 'char', 'nvarchar', 'nchar', 'text', 'ntext'].includes(t)) {
                    return "''";
                }
                if (['datetime', 'smalldatetime', 'date', 'datetime2', 'datetimeoffset', 'time'].includes(t)) {
                    return 'GETDATE()';
                }
                if (t === 'uniqueidentifier') {
                    return 'NEWID()';
                }
                if (['binary', 'varbinary', 'image'].includes(t)) {
                    return '0x0';
                }
                return '0';
            };

            const buildDynamicInsertQuery = (fullTableName, colsMeta, primaryMap) => {
                if (!Array.isArray(colsMeta) || colsMeta.length === 0) return null;
                const lowerMap = new Map();
                for (const [k, v] of Object.entries(primaryMap)) {
                    lowerMap.set(String(k).toLowerCase(), v);
                }

                const insertCols = [];
                const insertVals = [];

                for (const col of colsMeta) {
                    const colName = col.name;
                    const lowerName = String(colName).toLowerCase();
                    const isNotNullWithoutDefault = !col.is_nullable && Number(col.default_object_id || 0) === 0;

                    if (lowerMap.has(lowerName)) {
                        let expr = lowerMap.get(lowerName);
                        if (expr === 'NULL' && isNotNullWithoutDefault) {
                            expr = getNotNullFallbackExpr(col.type_name);
                        }
                        insertCols.push(`[${colName}]`);
                        insertVals.push(expr);
                    } else if (isNotNullWithoutDefault) {
                        insertCols.push(`[${colName}]`);
                        insertVals.push(getNotNullFallbackExpr(col.type_name));
                    }
                }

                if (insertCols.length === 0) return null;
                return `INSERT INTO ${fullTableName} (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')});`;
            };

            const [
                lancamentoColsMeta,
                vendaColsMeta,
                vendaProdutoColsMeta,
                financeiroPendenteColsMeta,
                vendaPagamentoColsMeta,
            ] = await Promise.all([
                getTableColumnsMeta('dbo.Lancamento'),
                getTableColumnsMeta('dbo.Venda'),
                getTableColumnsMeta('dbo.Venda_Produto'),
                getTableColumnsMeta('dbo.Financeiro_Pendente'),
                getTableColumnsMeta('dbo.Venda_Pagamento'),
            ]);

            const hasLancamentoCol = (colName) =>
                lancamentoColsMeta.some((c) => String(c.name).toLowerCase() === String(colName).toLowerCase());

            const hasFinPendCol = (colName) =>
                financeiroPendenteColsMeta.some((c) => String(c.name).toLowerCase() === String(colName).toLowerCase());

            const hasVendaPagCol = (colName) =>
                vendaPagamentoColsMeta.some((c) => String(c.name).toLowerCase() === String(colName).toLowerCase());

            const lancamentoInsertSql = buildDynamicInsertQuery('dbo.Lancamento', lancamentoColsMeta, {
                CodigoLancamento: '@NovoCodigoLancamento',
                CodigoEmpresa: '1',
                DataLancamento: 'GETDATE()',
                CodigoUsuario: '@CodigoUsuarioFinal',
                Operacao: '1',
                CodigoEstacao: '@CodigoEstacaoFinal',
                rowguid: 'NEWID()',
            });

            const vendaInsertSql = buildDynamicInsertQuery('dbo.Venda', vendaColsMeta, {
                CodigoVenda: '@NovoCodigoVenda',
                CodigoEmpresa: '1',
                CodigoLancamento: '@NovoCodigoLancamento',
                CodigoFuncionario: '@CodigoFuncionarioVenda',
                CodigoConvenio: 'NULL',
                DataVenda: 'GETDATE()',
                CodigoCadastro: '0',
                Cupom: 'NULL',
                Estoque: '1',
                TotalBruto: '@TotalBruto',
                TotalDesconto: '@TotalDesconto',
                TotalLiquido: '@TotalLiquido',
                Troco: '0.00',
                Cesta: '@NumeroCesta',
                Eliminado: '0',
                PedidoAntigo: 'NULL',
                rowguid: 'NEWID()',
                Status: '0',
                CodigoAbertura: 'NULL',
            });

            const isGrupoInvNotNull = vendaProdutoColsMeta.some(
                (c) =>
                    String(c.name).toLowerCase() === 'codigogrupoinventario' &&
                    !c.is_nullable &&
                    Number(c.default_object_id || 0) === 0
            );

            const vendaProdutoInsertSql = buildDynamicInsertQuery('dbo.Venda_Produto', vendaProdutoColsMeta, {
                CodigoVendaID: '@CodigoVendaID',
                CodigoVenda: '@CodigoVenda',
                CodigoFuncionario: '@CodigoFuncionario',
                CodigoProduto: '@CodigoProduto',
                Quantidade: '@Quantidade',
                PrecoUnitario: '@PrecoUnitario',
                DescontoUnitario: '@DescontoUnitario',
                Total: '@Total',
                PrecoCusto: '@PrecoCusto',
                TotalDesconto: '@TotalDesconto',
                Fracao: '1',
                Unidade: '@Unidade',
                rowguid: 'NEWID()',
                CodigoGrupoInventario: isGrupoInvNotNull ? 'ISNULL(@CodigoGrupoInventario, 0)' : '@CodigoGrupoInventario',
            });

            const financeiroPendenteInsertSql = buildDynamicInsertQuery('dbo.Financeiro_Pendente', financeiroPendenteColsMeta, {
                CodigoPendente: '@NovoCodigoPendente',
                CodigoLancamento: '@NovoCodigoLancamento',
                CodigoOperacao: '1',
                CodigoGrupo: '1',
                Historico: '@HistoricoPendente',
                Valor: '@TotalLiquido',
                CodigoEspecie: '1',
                Parcela: '1',
                CodigoPBM: 'NULL',
                Entrega: 'NULL',
                Cesta: '@CestaPendente',
                CodigoFuncionario: '@CodigoFuncionario',
                Troco: '0.00',
                CodigoLancamentoConferencia: 'NULL',
                rowguid: 'NEWID()',
                DataEfetivacao: 'NULL',
            });

            const vendaPagamentoInsertSql = buildDynamicInsertQuery('dbo.Venda_Pagamento', vendaPagamentoColsMeta, {
                CodigoVendaID: '@NovoCodigoVendaPagID',
                CodigoVenda: '@NovoCodigoVenda',
                CodigoPagamento: '1',
                CodigoPlano: '1',
                Valor: '@TotalLiquido',
                Parcela: '1',
                rowguid: 'NEWID()',
            });

            // 5. Inicia a transação SQL Server com UPDLOCK, HOLDLOCK
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

            const headerReq = new sql.Request(transaction);
            const rawOrderSeller =
                order.sellerCode ??
                order.erp_seller_code ??
                order.seller_code ??
                customer.sellerCode ??
                customer.erp_seller_code ??
                customer._pdv?.sellerCode ??
                customer._pdv?.erp_seller_code;
            const parsedOrderSellerDigits =
                rawOrderSeller !== undefined && rawOrderSeller !== null
                    ? String(rawOrderSeller).replace(/\D/g, '').trim()
                    : '';
            const orderSellerId =
                parsedOrderSellerDigits !== '' && Number(parsedOrderSellerDigits) > 0
                    ? Number(parsedOrderSellerDigits)
                    : null;

            const configuredFuncId =
                this.defaultFuncionarioId && !isNaN(Number(this.defaultFuncionarioId)) && Number(this.defaultFuncionarioId) > 0
                    ? Number(this.defaultFuncionarioId)
                    : null;

            headerReq.input('OrderSellerCode', sql.Int, orderSellerId);
            headerReq.input('ConfiguredFuncionario', sql.Int, configuredFuncId);
            headerReq.input('TotalBruto', sql.Money, headerTotalBruto);
            headerReq.input('TotalDesconto', sql.Money, headerTotalDesconto);
            headerReq.input('TotalLiquido', sql.Money, headerTotalLiquido);

            // Passo 1 e 2: Grava dbo.Lancamento e dbo.Venda (Pré-Venda ativa com Status = 0 e Cesta de 4 dígitos)
            const vendaHeaderRes = await headerReq.query(`
                DECLARE @NovoCodigoLancamento BIGINT;
                DECLARE @NovoCodigoVenda BIGINT = NULL;
                DECLARE @BaseCodigoVendaID BIGINT = 1;
                DECLARE @NumeroCesta INT = NULL;
                DECLARE @CodigoFuncionarioVenda INT = NULL;
                DECLARE @CodigoUsuarioFinal INT = NULL;
                DECLARE @OperacaoFinal INT = 1;
                DECLARE @CodigoEstacaoFinal INT = NULL;

                IF @OrderSellerCode IS NOT NULL AND @OrderSellerCode > 0
                BEGIN
                    IF OBJECT_ID('dbo.Funcionario', 'U') IS NOT NULL
                    BEGIN
                        SELECT TOP 1 @CodigoFuncionarioVenda = CodigoFuncionario
                        FROM dbo.Funcionario
                        WHERE CodigoFuncionario = @OrderSellerCode;

                        IF @CodigoFuncionarioVenda IS NULL
                           AND NOT EXISTS (
                               SELECT 1
                               FROM sys.foreign_keys
                               WHERE parent_object_id = OBJECT_ID('dbo.Venda')
                                 AND referenced_object_id = OBJECT_ID('dbo.Funcionario')
                           )
                        BEGIN
                            SET @CodigoFuncionarioVenda = @OrderSellerCode;
                        END
                    END
                    ELSE
                    BEGIN
                        SET @CodigoFuncionarioVenda = @OrderSellerCode;
                    END
                END

                IF @CodigoFuncionarioVenda IS NULL AND @ConfiguredFuncionario IS NOT NULL AND @ConfiguredFuncionario > 0
                BEGIN
                    SET @CodigoFuncionarioVenda = @ConfiguredFuncionario;
                END

                IF @CodigoFuncionarioVenda IS NULL AND OBJECT_ID('dbo.Venda', 'U') IS NOT NULL
                BEGIN
                    SELECT TOP 1 @CodigoFuncionarioVenda = CodigoFuncionario
                    FROM dbo.Venda
                    WHERE Cesta IS NOT NULL AND CodigoFuncionario IS NOT NULL
                    ORDER BY CodigoVenda DESC;

                    IF @CodigoFuncionarioVenda IS NULL
                    BEGIN
                        SELECT TOP 1 @CodigoFuncionarioVenda = CodigoFuncionario
                        FROM dbo.Venda
                        WHERE CodigoFuncionario IS NOT NULL AND CodigoFuncionario > 0
                        ORDER BY CodigoVenda DESC;
                    END
                END

                IF @CodigoFuncionarioVenda IS NULL
                    SET @CodigoFuncionarioVenda = 91;

                IF OBJECT_ID('dbo.Lancamento', 'U') IS NOT NULL
                BEGIN
                    SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                    FROM dbo.Lancamento WITH (UPDLOCK, HOLDLOCK);
                END
                ELSE IF OBJECT_ID('dbo.Venda', 'U') IS NOT NULL
                BEGIN
                    SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                    FROM dbo.Venda WITH (UPDLOCK, HOLDLOCK);
                END
                ELSE
                BEGIN
                    SELECT @NovoCodigoLancamento = ISNULL(MAX(CodigoLancamento), 1) + 10
                    FROM dbo.Orcamento WITH (UPDLOCK, HOLDLOCK);
                END

                ${lancamentoInsertSql ? `
                IF OBJECT_ID('dbo.Lancamento', 'U') IS NOT NULL
                BEGIN
                    ${hasLancamentoCol('CodigoUsuario') && hasLancamentoCol('CodigoEstacao') && hasLancamentoCol('Operacao') ? `
                    IF OBJECT_ID('dbo.Venda', 'U') IS NOT NULL
                    BEGIN
                        SELECT TOP 1
                            @CodigoUsuarioFinal = l.CodigoUsuario,
                            @CodigoEstacaoFinal = l.CodigoEstacao
                        FROM dbo.Lancamento l
                        INNER JOIN dbo.Venda v ON v.CodigoLancamento = l.CodigoLancamento
                        WHERE l.Operacao = 1 AND l.CodigoEstacao IS NOT NULL
                        ORDER BY l.CodigoLancamento DESC;
                    END
                    ` : ''}

                    SET @OperacaoFinal = 1;
                    IF @CodigoUsuarioFinal IS NULL SET @CodigoUsuarioFinal = 241;
                    IF @CodigoEstacaoFinal IS NULL SET @CodigoEstacaoFinal = 411;

                    ${lancamentoInsertSql}
                END
                ` : ''}

                ${vendaInsertSql && vendaProdutoInsertSql ? `
                IF OBJECT_ID('dbo.Venda', 'U') IS NOT NULL AND OBJECT_ID('dbo.Venda_Produto', 'U') IS NOT NULL
                BEGIN
                    SELECT @NovoCodigoVenda = ISNULL(MAX(CodigoVenda), 1) + 10
                    FROM dbo.Venda WITH (UPDLOCK, HOLDLOCK);

                    SELECT @BaseCodigoVendaID = ISNULL(MAX(CodigoVendaID), 1)
                    FROM dbo.Venda_Produto WITH (UPDLOCK, HOLDLOCK);

                    SET @NumeroCesta = CAST(((CAST(@NovoCodigoVenda AS BIGINT) / 10) % 9000) + 1000 AS INT);

                    ${vendaInsertSql}
                END
                ` : ''}

                SELECT
                    @NovoCodigoLancamento AS CodigoLancamento,
                    @NovoCodigoVenda AS CodigoVenda,
                    @BaseCodigoVendaID AS BaseCodigoVendaID,
                    @NumeroCesta AS NumeroCesta,
                    @CodigoFuncionarioVenda AS CodigoFuncionario;
            `);

            const vendaRow = vendaHeaderRes?.recordset?.[0] || {};
            const novoCodigoLancamento = Number(vendaRow.CodigoLancamento);
            const novoCodigoVenda = vendaRow.CodigoVenda ? Number(vendaRow.CodigoVenda) : null;
            const numeroCesta = vendaRow.NumeroCesta ? Number(vendaRow.NumeroCesta) : null;
            const codigoFuncionarioVenda = vendaRow.CodigoFuncionario ? Number(vendaRow.CodigoFuncionario) : 91;
            let currentCodigoVendaID = Number(vendaRow.BaseCodigoVendaID || 1);

            // Passo 3: Insere cada item em dbo.Venda_Produto dinamicamente somando +10 ao CodigoVendaID
            if (novoCodigoVenda && vendaProdutoInsertSql) {
                for (const item of preparedItems) {
                    currentCodigoVendaID += 10;
                    const vpReq = new sql.Request(transaction);
                    vpReq.input('CodigoVendaID', sql.BigInt, currentCodigoVendaID);
                    vpReq.input('CodigoVenda', sql.BigInt, novoCodigoVenda);
                    vpReq.input('CodigoFuncionario', sql.Int, codigoFuncionarioVenda);
                    vpReq.input('CodigoProduto', sql.Int, item.codigoProduto);
                    vpReq.input('Quantidade', sql.Numeric(18, 4), item.quantidade);
                    vpReq.input('PrecoUnitario', sql.Money, item.precoBrutoUnit);
                    vpReq.input('DescontoUnitario', sql.Money, item.descontoUnit);
                    vpReq.input('Total', sql.Money, item.totalLiquido);
                    vpReq.input('PrecoCusto', sql.Money, item.precoCusto);
                    vpReq.input('TotalDesconto', sql.Money, item.totalDesconto);
                    vpReq.input('Unidade', sql.VarChar(5), item.unidade || 'UN');
                    vpReq.input('CodigoGrupoInventario', sql.Int, item.codigoGrupoInventario ?? null);

                    await vpReq.query(vendaProdutoInsertSql);
                }
            }

            // Passo 3.1: Gravação em dbo.Financeiro_Pendente e dbo.Venda_Pagamento (alimentam "Lançamentos Pendentes" do Caixa)
            if (novoCodigoVenda && (financeiroPendenteInsertSql || vendaPagamentoInsertSql)) {
                const rawCustomerName = String(
                    order.customer_name ||
                    customer.name ||
                    customer.nome ||
                    order.customerName ||
                    'CONSUMIDOR'
                ).trim();
                const historicoClientePendente = truncateStr(
                    (rawCustomerName || 'CONSUMIDOR').toUpperCase(),
                    50,
                    'CONSUMIDOR'
                );

                const finCestaCol = financeiroPendenteColsMeta.find((c) => String(c.name).toLowerCase() === 'cesta');
                const isFinCestaText =
                    finCestaCol &&
                    ['varchar', 'char', 'nvarchar', 'nchar', 'text', 'ntext'].includes(String(finCestaCol.type_name).toLowerCase());

                const finPagReq = new sql.Request(transaction);
                finPagReq.input('NovoCodigoLancamento', sql.BigInt, novoCodigoLancamento);
                finPagReq.input('NovoCodigoVenda', sql.BigInt, novoCodigoVenda);
                finPagReq.input('HistoricoPendente', sql.VarChar(50), historicoClientePendente);
                finPagReq.input('TotalLiquido', sql.Money, headerTotalLiquido);
                if (isFinCestaText) {
                    finPagReq.input('CestaPendente', sql.VarChar(20), numeroCesta !== null ? String(numeroCesta) : null);
                } else {
                    finPagReq.input('CestaPendente', sql.Int, numeroCesta);
                }
                finPagReq.input('CodigoFuncionario', sql.Int, codigoFuncionarioVenda);

                await finPagReq.query(`
                    ${financeiroPendenteInsertSql ? `
                    IF OBJECT_ID('dbo.Financeiro_Pendente', 'U') IS NOT NULL
                    BEGIN
                        DECLARE @NovoCodigoPendente BIGINT = 11;
                        ${hasFinPendCol('CodigoPendente') ? `
                        DECLARE @Pend1 BIGINT = NULL, @Pend2 BIGINT = NULL, @StepPend BIGINT = 10;
                        SELECT TOP 1 @Pend1 = CodigoPendente FROM dbo.Financeiro_Pendente WITH (UPDLOCK, HOLDLOCK) ORDER BY CodigoPendente DESC;
                        IF @Pend1 IS NOT NULL
                        BEGIN
                            SELECT TOP 1 @Pend2 = CodigoPendente FROM dbo.Financeiro_Pendente WHERE CodigoPendente < @Pend1 ORDER BY CodigoPendente DESC;
                            IF @Pend2 IS NOT NULL AND (@Pend1 - @Pend2) > 0
                                SET @StepPend = (@Pend1 - @Pend2);
                            SET @NovoCodigoPendente = @Pend1 + @StepPend;
                        END
                        ` : ''}

                        ${financeiroPendenteInsertSql}
                    END
                    ` : ''}

                    ${vendaPagamentoInsertSql ? `
                    IF OBJECT_ID('dbo.Venda_Pagamento', 'U') IS NOT NULL
                    BEGIN
                        DECLARE @NovoCodigoVendaPagID BIGINT = 11;
                        ${hasVendaPagCol('CodigoVendaID') ? `
                        DECLARE @Vp1 BIGINT = NULL, @Vp2 BIGINT = NULL, @StepVp BIGINT = 10;
                        SELECT TOP 1 @Vp1 = CodigoVendaID FROM dbo.Venda_Pagamento WITH (UPDLOCK, HOLDLOCK) ORDER BY CodigoVendaID DESC;
                        IF @Vp1 IS NOT NULL
                        BEGIN
                            SELECT TOP 1 @Vp2 = CodigoVendaID FROM dbo.Venda_Pagamento WHERE CodigoVendaID < @Vp1 ORDER BY CodigoVendaID DESC;
                            IF @Vp2 IS NOT NULL AND (@Vp1 - @Vp2) > 0
                                SET @StepVp = (@Vp1 - @Vp2);
                            SET @NovoCodigoVendaPagID = @Vp1 + @StepVp;
                        END
                        ` : ''}

                        ${vendaPagamentoInsertSql}
                    END
                    ` : ''}
                `);
            }

            // Passo 4: Mantém gravação em dbo.Orcamento, dbo.Orcamento_Produto e dbo.Orcamento_PV (dentro de TRY/CATCH para compatibilidade)
            let novoCodigoOrcamento = null;
            let novoCodigoPV = null;
            try {
                const orcReq = new sql.Request(transaction);
                orcReq.input('NovoCodigoLancamento', sql.BigInt, novoCodigoLancamento);
                orcReq.input('CodigoFuncionario', sql.Int, codigoFuncionarioVenda);
                orcReq.input('TotalBruto', sql.Money, headerTotalBruto);
                orcReq.input('TotalDesconto', sql.Money, headerTotalDesconto);
                orcReq.input('TotalLiquido', sql.Money, headerTotalLiquido);
                orcReq.input('Observacao', sql.VarChar(200), observacaoHeader);
                orcReq.input('NomeCliente', sql.VarChar(100), nomeCliente);

                const orcHeaderRes = await orcReq.query(`
                    DECLARE @NovoCodigoOrcamento BIGINT = NULL;
                    DECLARE @BaseCodigoOrcamentoID BIGINT = 1;
                    DECLARE @NovoCodigoPV INT = NULL;
                    DECLARE @StepPV INT = 1;

                    IF OBJECT_ID('dbo.Orcamento', 'U') IS NOT NULL
                       AND OBJECT_ID('dbo.Orcamento_Produto', 'U') IS NOT NULL
                       AND OBJECT_ID('dbo.Orcamento_PV', 'U') IS NOT NULL
                    BEGIN
                        BEGIN TRY
                            SELECT @NovoCodigoOrcamento = ISNULL(MAX(CodigoOrcamento), 1) + 10
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
                                @CodigoFuncionario,
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
                        END TRY
                        BEGIN CATCH
                            SET @NovoCodigoOrcamento = NULL;
                            SET @NovoCodigoPV = NULL;
                        END CATCH
                    END

                    SELECT
                        @NovoCodigoOrcamento AS CodigoOrcamento,
                        @BaseCodigoOrcamentoID AS BaseCodigoOrcamentoID,
                        @NovoCodigoPV AS CodigoPV;
                `);

                const orcRow = orcHeaderRes?.recordset?.[0] || {};
                if (orcRow.CodigoOrcamento) {
                    novoCodigoOrcamento = Number(orcRow.CodigoOrcamento);
                    novoCodigoPV = orcRow.CodigoPV ? Number(orcRow.CodigoPV) : null;
                    let currentCodigoOrcamentoID = Number(orcRow.BaseCodigoOrcamentoID || 1);

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
                        itemReq.input('Unidade', sql.VarChar(5), item.unidade || 'UN');

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
                }
            } catch (orcErr) {
                console.warn('⚠️ Aviso: Gravação complementar em dbo.Orcamento ignorada:', orcErr.message);
            }

            // 5. Gravação condicional em dbo.Entrega (usando as colunas reais do InovaFarma)
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

            const erpOrderId =
                numeroCesta && novoCodigoVenda
                    ? `Cesta #${numeroCesta} (Venda #${novoCodigoVenda})`
                    : novoCodigoPV && novoCodigoOrcamento
                        ? `Pré-Venda #${novoCodigoPV} • Orç #${novoCodigoOrcamento}`
                        : `Venda #${novoCodigoVenda || novoCodigoOrcamento}`;

            console.log(
                `[PRÉ-VENDA PDV] Pedido inserido com sucesso! Cesta: #${numeroCesta} | CodigoVenda: #${novoCodigoVenda} | Orçamento: #${novoCodigoOrcamento}`
            );

            return {
                success: true,
                erpOrderId,
                numeroCesta,
                codigoVenda: novoCodigoVenda,
                codigoOrcamento: novoCodigoOrcamento,
                codigoLancamento: novoCodigoLancamento,
                codigoPV: novoCodigoPV,
                codigoEntrega: novoCodigoEntrega,
                codigoFuncionario: codigoFuncionarioVenda,
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
