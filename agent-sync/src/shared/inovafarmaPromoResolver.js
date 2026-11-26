const sql = require('mssql');
const { loadConfig } = require('./state');
const { getFieldIgnoreCase, extractBarcode, extractInternalCode } = require('./priceNormalizer');

function roundMoney(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeIdentifier(name) {
    return String(name || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function findMatchingColumn(columns, candidates) {
    if (!Array.isArray(columns) || columns.length === 0) return null;
    const normMap = new Map();
    for (const col of columns) {
        const colName = typeof col === 'string' ? col : col.COLUMN_NAME;
        if (!colName) continue;
        const nk = normalizeIdentifier(colName);
        if (nk && !normMap.has(nk)) {
            normMap.set(nk, colName);
        }
    }
    for (const candidate of candidates) {
        if (candidate instanceof RegExp) {
            for (const col of columns) {
                const colName = typeof col === 'string' ? col : col.COLUMN_NAME;
                const nk = normalizeIdentifier(colName);
                if (candidate.test(nk) || candidate.test(colName)) {
                    return colName;
                }
            }
        } else {
            const nk = normalizeIdentifier(candidate);
            if (normMap.has(nk)) {
                return normMap.get(nk);
            }
        }
    }
    return null;
}

function findAllMatchingColumns(columns, candidates) {
    if (!Array.isArray(columns) || columns.length === 0) return [];
    const matched = [];
    const seen = new Set();
    for (const col of columns) {
        const colName = typeof col === 'string' ? col : col.COLUMN_NAME;
        if (!colName) continue;
        const nk = normalizeIdentifier(colName);
        for (const candidate of candidates) {
            const isMatch =
                candidate instanceof RegExp
                    ? candidate.test(nk) || candidate.test(colName)
                    : nk === normalizeIdentifier(candidate);
            if (isMatch && !seen.has(colName)) {
                seen.add(colName);
                matched.push(colName);
                break;
            }
        }
    }
    return matched;
}

/**
 * Verifica se a opção "Ignorar campanhas da aba Promoção (usar apenas Preço Prom. do produto)"
 * está ativa na configuração local (farmaflow_config.json), variáveis de ambiente (.env) ou opções em tempo de execução.
 */
function resolveIgnorePromotionCampaignsFlag(dbConfig = {}, runtimeOptions = {}) {
    if (runtimeOptions && typeof runtimeOptions.ignorePromotionCampaigns === 'boolean') {
        return runtimeOptions.ignorePromotionCampaigns;
    }
    if (runtimeOptions && typeof runtimeOptions.ignore_promotion_campaigns === 'boolean') {
        return runtimeOptions.ignore_promotion_campaigns;
    }
    if (dbConfig && typeof dbConfig.ignorePromotionCampaigns === 'boolean') {
        return dbConfig.ignorePromotionCampaigns;
    }
    if (dbConfig && typeof dbConfig.ignore_promotion_campaigns === 'boolean') {
        return dbConfig.ignore_promotion_campaigns;
    }

    const envVal = String(
        process.env.IGNORE_PROMOTION_CAMPAIGNS ||
        process.env.IGNORAR_CAMPANHAS_PROMOCAO ||
        ''
    ).trim().toLowerCase();
    if (['true', '1', 's', 'sim', 'yes'].includes(envVal)) {
        return true;
    }
    if (['false', '0', 'n', 'nao', 'não', 'no'].includes(envVal)) {
        return false;
    }

    try {
        const savedCfg = loadConfig();
        if (savedCfg) {
            if (typeof savedCfg.ignorePromotionCampaigns === 'boolean') {
                return savedCfg.ignorePromotionCampaigns;
            }
            if (typeof savedCfg.ignore_promotion_campaigns === 'boolean') {
                return savedCfg.ignore_promotion_campaigns;
            }
            if (savedCfg.dbConfig && typeof savedCfg.dbConfig.ignorePromotionCampaigns === 'boolean') {
                return savedCfg.dbConfig.ignorePromotionCampaigns;
            }
            if (savedCfg.dbConfig && typeof savedCfg.dbConfig.ignore_promotion_campaigns === 'boolean') {
                return savedCfg.dbConfig.ignore_promotion_campaigns;
            }
        }
    } catch (_) {}

    return false;
}

/**
 * Inspeciona dinamicamente via INFORMATION_SCHEMA.COLUMNS as tabelas de Produto/Estoque e Promoção/Campanha
 * do InovaFarma (ex: V1.81.104), incluindo as colunas de controle de dias da semana (Seg..Dom ou DiasSemana).
 */
async function inspectInovaFarmaSchema(pool) {
    try {
        const checkProd = await pool.request().query(`
            SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
            SET NOCOUNT ON;
            SELECT CASE WHEN OBJECT_ID('dbo.Produto', 'U') IS NOT NULL THEN 1 ELSE 0 END AS HasProduto;
        `);
        if (!checkProd?.recordset?.[0]?.HasProduto) {
            return { isInovaFarma: false, reason: 'Tabela dbo.Produto não encontrada no banco.' };
        }

        const colsRes = await pool.request().query(`
            SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
            SET NOCOUNT ON;
            SELECT
                TABLE_NAME,
                COLUMN_NAME,
                LOWER(DATA_TYPE) AS DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND (
                TABLE_NAME IN (
                    'Produto', 'Produto_Estoque', 'Produto_Loja', 'Produto_Filial', 'Produto_Empresa', 'Produto_Preco', 'Estoque', 'Estoque_Loja',
                    'Promocao', 'Promocao_Produto', 'PromocaoProduto', 'Promocao_Item', 'PromocaoItem', 'Promocao_Itens',
                    'Promocao_Empresa', 'Promocao_Filial', 'Promocao_Loja',
                    'Promocao_Dia', 'Promocao_DiaSemana',
                    'Campanha', 'Campanha_Produto', 'CampanhaProduto', 'TabelaPromocao', 'TabelaPromocao_Produto'
                )
                OR TABLE_NAME LIKE 'Promo%'
                OR TABLE_NAME LIKE 'Campanha%'
              )
            ORDER BY TABLE_NAME, ORDINAL_POSITION;
        `);

        // Detecta dinamicamente via INFORMATION_SCHEMA.TABLES qualquer tabela iniciada por Promocao_Dia (ex: Promocao_Dia, Promocao_DiaSemana)
        let promoDiaTableNames = [];
        try {
            const diaTablesRes = await pool.request().query(`
                SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                SET NOCOUNT ON;
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = 'dbo'
                  AND TABLE_TYPE = 'BASE TABLE'
                  AND TABLE_NAME LIKE 'Promocao_Dia%'
                ORDER BY CASE
                    WHEN TABLE_NAME = 'Promocao_Dia' THEN 0
                    WHEN TABLE_NAME = 'Promocao_DiaSemana' THEN 1
                    ELSE 2
                END, TABLE_NAME;
            `);
            promoDiaTableNames = (diaTablesRes?.recordset || []).map(r => r.TABLE_NAME).filter(Boolean);
        } catch (_) {}

        const tablesMap = new Map();
        for (const row of colsRes?.recordset || []) {
            const tName = row.TABLE_NAME;
            if (!tablesMap.has(tName)) {
                tablesMap.set(tName, []);
            }
            tablesMap.get(tName).push(row);
        }

        const produtoCols = tablesMap.get('Produto') || [];
        const prodIdCol = findMatchingColumn(produtoCols, ['CodigoProduto', 'IdProduto', 'CodProduto', 'Codigo']);
        if (!prodIdCol) {
            return {
                isInovaFarma: false,
                reason: 'Coluna de chave primária (CodigoProduto) não encontrada em dbo.Produto.'
            };
        }

        const prodSellingPriceCol = findMatchingColumn(produtoCols, [
            'PrecoVenda', 'Preco_Venda', 'ValorVenda', 'VlVenda', 'Preco', 'PrecoBruto'
        ]);
        const prodPromoPriceCol = findMatchingColumn(produtoCols, [
            'PrecoPromocao', 'PrecoPromocional', 'Preco_Promocao', 'Preco_Promocional',
            'ValorPromocao', 'VlPromocao', 'PrecoOferta', 'PrecoDesconto', 'PrecoEspecial'
        ]);
        const prodPromoStartCol = findMatchingColumn(produtoCols, [
            'DataPromocaoInicio', 'DataInicioPromocao', 'DataInicialPromocao', 'InicioPromocao',
            'DtInicioPromocao', 'PromocaoDataInicial', 'PromocaoDataInicio', 'DataOfertaInicio'
        ]);
        const prodPromoEndCol = findMatchingColumn(produtoCols, [
            'DataPromocaoFim', 'DataFimPromocao', 'DataFinalPromocao', 'FimPromocao',
            'DtFimPromocao', 'ValidadePromocao', 'PromocaoDataFinal', 'PromocaoDataFim', 'DataOfertaFim'
        ]);

        // Verifica tabela de preço/estoque por filial (priorizando dbo.Produto_Estoque confirmado no InovaFarma)
        let branchStockTable = null;
        const candidateBranchTables = ['Produto_Estoque', 'Produto_Loja', 'Produto_Empresa', 'Produto_Filial', 'Produto_Preco', 'Estoque_Loja', 'Estoque'];
        for (const bt of candidateBranchTables) {
            if (!tablesMap.has(bt)) continue;
            const bCols = tablesMap.get(bt);
            const bProdIdCol = findMatchingColumn(bCols, ['CodigoProduto', 'IdProduto', 'CodProduto']);
            const bBranchCol = findMatchingColumn(bCols, ['CodigoEmpresa', 'CodigoFilial', 'CodigoLoja', 'IdEmpresa', 'IdFilial', 'IdLoja', 'Filial', 'Loja']);
            const bSellingCol = findMatchingColumn(bCols, ['PrecoVenda', 'Preco_Venda', 'ValorVenda', 'VlVenda', 'Preco']);
            const bPromoCol = findMatchingColumn(bCols, [
                'PrecoPromocao', 'PrecoPromocional', 'Preco_Promocao', 'Preco_Promocional',
                'ValorPromocao', 'VlPromocao', 'PrecoOferta', 'PrecoDesconto', 'PrecoEspecial'
            ]);
            if (bProdIdCol && bBranchCol && (bSellingCol || bPromoCol)) {
                branchStockTable = {
                    tableName: bt,
                    prodIdCol: bProdIdCol,
                    branchCol: bBranchCol,
                    sellingPriceCol: bSellingCol,
                    promoPriceCol: bPromoCol,
                    promoStartCol: findMatchingColumn(bCols, [
                        'DataPromocaoInicio', 'DataInicioPromocao', 'DataInicialPromocao', 'InicioPromocao', 'DtInicioPromocao', 'DataOfertaInicio'
                    ]),
                    promoEndCol: findMatchingColumn(bCols, [
                        'DataPromocaoFim', 'DataFimPromocao', 'DataFinalPromocao', 'FimPromocao', 'DtFimPromocao', 'ValidadePromocao', 'DataOfertaFim'
                    ]),
                    offerStartCol: findMatchingColumn(bCols, ['DataOfertaInicio']),
                    offerEndCol: findMatchingColumn(bCols, ['DataOfertaFim']),
                    offerFlagCol: findMatchingColumn(bCols, ['Oferta', 'EmOferta', 'FlOferta'])
                };
                break;
            }
        }

        // Inspeciona tabelas de Campanhas / Promoções (aba PROMOÇÃO)
        const extractTablePromoMeta = (tableName, cols) => {
            const weekdayCols = {
                0: findMatchingColumn(cols, [
                    'Segunda', 'SegundaFeira', 'Segunda_Feira', 'Seg', 'DiaSegunda', 'Dia_Segunda',
                    'FlSegunda', 'FlagSegunda', 'IndSegunda', 'PromoSegunda', 'PromocaoSegunda'
                ]),
                1: findMatchingColumn(cols, [
                    'Terca', 'TercaFeira', 'Terca_Feira', 'Ter', 'DiaTerca', 'Dia_Terca',
                    'FlTerca', 'FlagTerca', 'IndTerca', 'PromoTerca', 'PromocaoTerca'
                ]),
                2: findMatchingColumn(cols, [
                    'Quarta', 'QuartaFeira', 'Quarta_Feira', 'Qua', 'DiaQuarta', 'Dia_Quarta',
                    'FlQuarta', 'FlagQuarta', 'IndQuarta', 'PromoQuarta', 'PromocaoQuarta'
                ]),
                3: findMatchingColumn(cols, [
                    'Quinta', 'QuintaFeira', 'Quinta_Feira', 'Qui', 'DiaQuinta', 'Dia_Quinta',
                    'FlQuinta', 'FlagQuinta', 'IndQuinta', 'PromoQuinta', 'PromocaoQuinta'
                ]),
                4: findMatchingColumn(cols, [
                    'Sexta', 'SextaFeira', 'Sexta_Feira', 'Sex', 'DiaSexta', 'Dia_Sexta',
                    'FlSexta', 'FlagSexta', 'IndSexta', 'PromoSexta', 'PromocaoSexta'
                ]),
                5: findMatchingColumn(cols, [
                    'Sabado', 'Sab', 'DiaSabado', 'Dia_Sabado',
                    'FlSabado', 'FlagSabado', 'IndSabado', 'PromoSabado', 'PromocaoSabado'
                ]),
                6: findMatchingColumn(cols, [
                    'Domingo', 'Dom', 'DiaDomingo', 'Dia_Domingo',
                    'FlDomingo', 'FlagDomingo', 'IndDomingo', 'PromoDomingo', 'PromocaoDomingo'
                ])
            };

            const hasIndividualWeekdayCols = Object.values(weekdayCols).some(Boolean);
            const combinedWeekdayCol = findMatchingColumn(cols, [
                'DiasSemana', 'DiaSemana', 'Dias_Semana', 'Dia_Semana',
                'DiasValidos', 'DiasPromocao', 'DiasCampanha', 'Dias'
            ]);

            return {
                tableName,
                cols,
                promoIdCol: findMatchingColumn(cols, ['CodigoPromocao', 'IdPromocao', 'CodPromocao', 'CodigoCampanha', 'IdCampanha', 'Codigo']),
                prodIdCol: findMatchingColumn(cols, ['CodigoProduto', 'IdProduto', 'CodProduto', 'Produto']),
                branchCol: findMatchingColumn(cols, ['CodigoEmpresa', 'CodigoFilial', 'CodigoLoja', 'IdEmpresa', 'IdFilial', 'IdLoja', 'Filial', 'Loja']),
                promoPriceCol: findMatchingColumn(cols, [
                    'PrecoPromocao', 'PrecoPromocional', 'Preco_Promocao', 'Preco_Promocional',
                    'ValorPromocao', 'ValorPromocional', 'VlPromocao', 'PrecoOferta',
                    'PrecoLiquido', 'PrecoDesconto', 'PrecoVenda', 'Preco', 'Valor'
                ]),
                discountPctCol: findMatchingColumn(cols, [
                    'Porcentagem', 'PercentualDesconto', 'PercDesconto', 'DescontoPercentual', 'AliquotaDesconto', 'Percentual', 'Desconto'
                ]),
                startDateCol: findMatchingColumn(cols, [
                    'DataInicial', 'DataInicio', 'DtInicial', 'DtInicio', 'Data_Inicial', 'Data_Inicio',
                    'VigenciaInicio', 'DataVigenciaInicial', 'DataHoraInicial', 'DataHoraInicio', 'Inicio'
                ]),
                endDateCol: findMatchingColumn(cols, [
                    'DataFinal', 'DataFim', 'DtFinal', 'DtFim', 'Data_Final', 'Data_Fim',
                    'VigenciaFim', 'DataVigenciaFinal', 'DataHoraFinal', 'DataHoraFim', 'Validade', 'Fim'
                ]),
                positiveActiveCols: findAllMatchingColumns(cols, ['Ativo', 'Ativa', 'FlAtivo', 'FlagAtivo', 'IndAtivo']),
                negativeInactiveCols: findAllMatchingColumns(cols, [
                    'Eliminado', 'Excluido', 'Cancelado', 'Cancelada', 'Inativo', 'Inativa',
                    'Bloqueado', 'Bloqueada', 'Encerrado', 'Encerrada', 'Finalizado', 'Finalizada', 'Desativado', 'Desativada'
                ]),
                statusCols: findAllMatchingColumns(cols, ['Situacao', 'Status']),
                cancelDateCols: findAllMatchingColumns(cols, [
                    'DataCancelamento', 'DataExclusao', 'DataEncerramento', 'DataInativacao', 'DataFinalizacao'
                ]),
                nameCol: findMatchingColumn(cols, [
                    'NomePromocao', 'Descricao', 'Nome', 'DescricaoPromocao', 'NomeCampanha', 'DescricaoCampanha', 'Titulo', 'Campanha'
                ]),
                weekdayCols,
                hasIndividualWeekdayCols,
                combinedWeekdayCol
            };
        };

        const headerCandidateNames = ['Promocao', 'Campanha', 'TabelaPromocao'];
        const itemCandidateNames = [
            'Promocao_Produto', 'PromocaoProduto', 'Promocao_Item', 'PromocaoItem', 'Promocao_Itens',
            'Campanha_Produto', 'CampanhaProduto', 'TabelaPromocao_Produto'
        ];

        // Adiciona quaisquer outras tabelas descobertas que comecem com Promo ou Campanha
        for (const tName of tablesMap.keys()) {
            if (/^promo/i.test(tName) || /^campanha/i.test(tName)) {
                if (/produto|item|itens/i.test(tName)) {
                    if (!itemCandidateNames.includes(tName)) itemCandidateNames.push(tName);
                } else if (!/empresa|filial|loja|^promocao_dia/i.test(tName)) {
                    if (!headerCandidateNames.includes(tName)) headerCandidateNames.push(tName);
                }
            }
        }

        let campaignSource = null;

        // 1. Tenta par Cabeçalho + Itens (ex: dbo.Promocao + dbo.Promocao_Produto)
        for (const hName of headerCandidateNames) {
            if (!tablesMap.has(hName)) continue;
            const hMeta = extractTablePromoMeta(hName, tablesMap.get(hName));
            if (!hMeta.promoIdCol) continue;

            for (const iName of itemCandidateNames) {
                if (!tablesMap.has(iName) || iName === hName) continue;
                const iMeta = extractTablePromoMeta(iName, tablesMap.get(iName));
                const joinColOnItem = findMatchingColumn(iMeta.cols, [
                    hMeta.promoIdCol, 'CodigoPromocao', 'IdPromocao', 'CodPromocao', 'CodigoCampanha', 'IdCampanha'
                ]);
                if (joinColOnItem && iMeta.prodIdCol && (iMeta.promoPriceCol || iMeta.discountPctCol || hMeta.promoPriceCol || hMeta.discountPctCol)) {
                    campaignSource = {
                        mode: 'header_detail',
                        header: hMeta,
                        item: { ...iMeta, joinCol: joinColOnItem }
                    };
                    break;
                }
            }
            if (campaignSource) break;
        }

        // 2. Fallback: Tabela única de promoção que já contém CodigoProduto (ex: dbo.Promocao com CodigoProduto)
        if (!campaignSource) {
            for (const tName of [...headerCandidateNames, ...itemCandidateNames]) {
                if (!tablesMap.has(tName)) continue;
                const tMeta = extractTablePromoMeta(tName, tablesMap.get(tName));
                if (tMeta.prodIdCol && (tMeta.promoPriceCol || tMeta.discountPctCol)) {
                    campaignSource = {
                        mode: 'single_table',
                        header: tMeta,
                        item: null
                    };
                    break;
                }
            }
        }

        // 3. Detecta tabela de vínculo campanha x filial (dbo.Promocao_Empresa / Promocao_Filial / Promocao_Loja)
        let campaignBranchTable = null;
        for (const btName of ['Promocao_Empresa', 'Promocao_Filial', 'Promocao_Loja']) {
            if (!tablesMap.has(btName)) continue;
            const btCols = tablesMap.get(btName);
            const btPromoIdCol = findMatchingColumn(btCols, ['CodigoPromocao', 'IdPromocao', 'CodPromocao', 'CodigoCampanha', 'IdCampanha']);
            const btBranchCol = findMatchingColumn(btCols, ['CodigoEmpresa', 'CodigoFilial', 'CodigoLoja', 'IdEmpresa', 'IdFilial', 'IdLoja', 'Filial', 'Loja']);
            if (btPromoIdCol && btBranchCol) {
                let hasRows = false;
                try {
                    const rowCheck = await pool.request().query(`
                        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                        SET NOCOUNT ON;
                        SELECT TOP 1 1 AS HasRow FROM dbo.[${btName}] WITH (NOLOCK);
                    `);
                    hasRows = Boolean(rowCheck?.recordset?.length);
                } catch (_) {}
                campaignBranchTable = {
                    tableName: btName,
                    promoIdCol: btPromoIdCol,
                    branchCol: btBranchCol,
                    hasRows
                };
                break;
            }
        }

        // 4. Detecta tabela filha de dias da semana (dbo.Promocao_Dia / dbo.Promocao_DiaSemana) e inspeciona convenção de Dia
        let campaignDayTable = null;
        for (const dtName of promoDiaTableNames) {
            const dtCols = tablesMap.get(dtName) || [];
            const dtPromoIdCol = findMatchingColumn(dtCols, ['CodigoPromocao', 'IdPromocao', 'CodPromocao', 'CodigoCampanha', 'IdCampanha']) || 'CodigoPromocao';
            const dtDayCol = findMatchingColumn(dtCols, ['Dia', 'DiaSemana', 'NumeroDia', 'NrDia', 'CodigoDia']) || 'Dia';
            let distinctDays = [];
            let convention = '1_sun_7_sat'; // Padrão SQL Server DATEPART(WEEKDAY): 1=Dom .. 7=Sáb

            try {
                const daysRes = await pool.request().query(`
                    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                    SET NOCOUNT ON;
                    SELECT DISTINCT CAST([${dtDayCol}] AS INT) AS DiaVal
                    FROM dbo.[${dtName}] WITH (NOLOCK)
                    WHERE [${dtDayCol}] IS NOT NULL
                    ORDER BY DiaVal;
                `);
                distinctDays = (daysRes?.recordset || [])
                    .map(r => Number(r.DiaVal))
                    .filter(n => Number.isInteger(n));

                if (distinctDays.some(d => d === 0)) {
                    convention = '0_sun_6_sat';
                } else if (campaignSource?.header?.nameCol && campaignSource.header.promoIdCol) {
                    const h = campaignSource.header;
                    const sampleRes = await pool.request().query(`
                        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
                        SET NOCOUNT ON;
                        SELECT TOP 100
                            CAST(pd.[${dtDayCol}] AS INT) AS DiaVal,
                            UPPER(CAST(ISNULL(pr.[${h.nameCol}], '') AS VARCHAR(200))) AS NomePromocao
                        FROM dbo.[${dtName}] pd WITH (NOLOCK)
                        INNER JOIN dbo.[${h.tableName}] pr WITH (NOLOCK)
                            ON pr.[${h.promoIdCol}] = pd.[${dtPromoIdCol}]
                        WHERE pd.[${dtDayCol}] IS NOT NULL;
                    `);
                    const dayNameChecks = [
                        { regex: /DOMINGO|\bDOM\b/, sun1: 1, iso1: 7 },
                        { regex: /SEGUNDA|\bSEG\b/, sun1: 2, iso1: 1 },
                        { regex: /TERCA|TERÇA|\bTER\b/, sun1: 3, iso1: 2 },
                        { regex: /QUARTA|\bQUA\b/, sun1: 4, iso1: 3 },
                        { regex: /QUINTA|\bQUI\b/, sun1: 5, iso1: 4 },
                        { regex: /SEXTOU|SEXTA|\bSEX\b/, sun1: 6, iso1: 5 },
                        { regex: /SABADO|SÁBADO|\bSAB\b/, sun1: 7, iso1: 6 }
                    ];
                    let sun1Hits = 0;
                    let iso1Hits = 0;
                    for (const sr of sampleRes?.recordset || []) {
                        const nm = String(sr.NomePromocao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        const dVal = Number(sr.DiaVal);
                        for (const chk of dayNameChecks) {
                            if (chk.regex.test(nm)) {
                                if (dVal === chk.sun1) sun1Hits++;
                                if (dVal === chk.iso1) iso1Hits++;
                            }
                        }
                    }
                    if (iso1Hits > sun1Hits) {
                        convention = '1_mon_7_sun';
                    }
                }
            } catch (_) {}

            campaignDayTable = {
                tableName: dtName,
                promoIdCol: dtPromoIdCol,
                dayCol: dtDayCol,
                distinctDays,
                convention
            };
            break;
        }

        return {
            isInovaFarma: true,
            discoveredTables: Array.from(tablesMap.keys()),
            produto: {
                tableName: 'Produto',
                prodIdCol,
                sellingPriceCol: prodSellingPriceCol,
                promoPriceCol: prodPromoPriceCol,
                promoStartCol: prodPromoStartCol,
                promoEndCol: prodPromoEndCol
            },
            branchStockTable,
            campaignSource,
            campaignBranchTable,
            campaignDayTable
        };
    } catch (err) {
        console.warn(`[InovaFarma Promo Inspector] Aviso ao inspecionar schema SQL: ${err.message}`);
        return { isInovaFarma: false, reason: err.message, error: err.message };
    }
}

/**
 * Imprime no log inicial do agente o diagnóstico detalhado das tabelas e colunas exatas
 * detectadas no SQL Server do InovaFarma (ou informa claramente caso tenha caído em fallback para a View).
 */
function logInovaFarmaSchemaDetection(schemaMeta, ignorePromotionCampaigns = false) {
    console.log('\n---------------------------------------------------');
    console.log('🔍 [Diagnóstico Schema InovaFarma - Promoções & Preços]');
    if (!schemaMeta || !schemaMeta.isInovaFarma) {
        console.log(
            `⚠️  FALLBACK PARA VIEW ATIVO: Schema nativo dbo.Produto não reconhecido (${schemaMeta?.reason || 'Tabela não localizada'}).`
        );
        console.log('   -> O agente utilizará exclusivamente os preços retornados pela View principal.');
        console.log('---------------------------------------------------\n');
        return;
    }

    const p = schemaMeta.produto || {};
    console.log(
        `✅ Tabela Base: dbo.${p.tableName} | PK: [${p.prodIdCol}] | Preço Venda: [${p.sellingPriceCol || 'N/A'}] | ` +
        `Preço Prom. Estoque: [${p.promoPriceCol || 'N/A'}] | Vigência Estoque: [${p.promoStartCol || 'N/A'} .. ${p.promoEndCol || 'N/A'}]`
    );

    const b = schemaMeta.branchStockTable;
    if (b) {
        console.log(
            `✅ Tabela Filial/Estoque: dbo.${b.tableName} | FK Produto: [${b.prodIdCol}] | Filial: [${b.branchCol}] | ` +
            `Preço Venda: [${b.sellingPriceCol || 'N/A'}] | Preço Prom.: [${b.promoPriceCol || 'N/A'}] | ` +
            `Vigência: [${b.promoStartCol || 'N/A'} .. ${b.promoEndCol || 'N/A'}]`
        );
    } else {
        console.log('ℹ️  Tabela Filial/Estoque: Nenhuma tabela separada de preço por filial detectada (usando dbo.Produto).');
    }

    const cs = schemaMeta.campaignSource;
    if (!cs) {
        console.log(
            '⚠️  Tabelas da Aba Promoção: Nenhuma tabela de campanha (dbo.Promocao / dbo.Promocao_Produto) reconhecida. ' +
            'Usando apenas o PREÇO PROM. da aba Estoque.'
        );
    } else if (cs.mode === 'header_detail' && cs.header && cs.item) {
        const h = cs.header;
        const i = cs.item;
        const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
        const detectedDayCols = dayNames
            .map((d, idx) => (h.weekdayCols?.[idx] ? `${d}=[${h.weekdayCols[idx]}]` : `${d}=N/A`))
            .join(', ');
        console.log(
            `✅ Aba Promoção (Cabeçalho): dbo.${h.tableName} | PK: [${h.promoIdCol}] | Nome: [${h.nameCol || 'N/A'}] | ` +
            `Vigência: [${h.startDateCol || 'N/A'} .. ${h.endDateCol || 'N/A'}] | ` +
            `Ativo: [${(h.positiveActiveCols || []).join(',') || 'N/A'}] | ` +
            `Inativo/Eliminado: [${(h.negativeInactiveCols || []).join(',') || 'N/A'}]`
        );
        console.log(
            `✅ Aba Promoção (Dias da Semana em dbo.${h.tableName}): ` +
            (schemaMeta.campaignDayTable
                ? `Tabela filha dbo.${schemaMeta.campaignDayTable.tableName} ([${schemaMeta.campaignDayTable.dayCol}], convenção=${schemaMeta.campaignDayTable.convention}, valores=${JSON.stringify(schemaMeta.campaignDayTable.distinctDays)})`
                : (h.hasIndividualWeekdayCols
                    ? `Colunas individuais -> ${detectedDayCols}`
                    : (h.combinedWeekdayCol ? `Coluna combinada -> [${h.combinedWeekdayCol}]` : 'Nenhuma coluna/tabela de dia da semana detectada')))
        );
        if (schemaMeta.campaignBranchTable) {
            const cb = schemaMeta.campaignBranchTable;
            console.log(
                `✅ Aba Promoção (Filiais): dbo.${cb.tableName} | Promo: [${cb.promoIdCol}] | Filial: [${cb.branchCol}] | Em uso: ${cb.hasRows ? 'SIM' : 'NÃO (tabela vazia)'}`
            );
        }
        console.log(
            `✅ Aba Promoção (Itens): dbo.${i.tableName} | Join: [${i.joinCol}] | FK Produto: [${i.prodIdCol}] | ` +
            `Preço Campanha: [${i.promoPriceCol || h.promoPriceCol || 'N/A'}] | Desconto %: [${i.discountPctCol || h.discountPctCol || 'N/A'}]`
        );
    } else if (cs.mode === 'single_table' && cs.header) {
        const h = cs.header;
        const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
        const detectedDayCols = dayNames
            .map((d, idx) => (h.weekdayCols?.[idx] ? `${d}=[${h.weekdayCols[idx]}]` : `${d}=N/A`))
            .join(', ');
        console.log(
            `✅ Aba Promoção (Tabela Única): dbo.${h.tableName} | FK Produto: [${h.prodIdCol}] | ` +
            `Preço Campanha: [${h.promoPriceCol || 'N/A'}] | Vigência: [${h.startDateCol || 'N/A'} .. ${h.endDateCol || 'N/A'}]`
        );
        console.log(
            `✅ Aba Promoção (Dias da Semana em dbo.${h.tableName}): ` +
            (schemaMeta.campaignDayTable
                ? `Tabela filha dbo.${schemaMeta.campaignDayTable.tableName} ([${schemaMeta.campaignDayTable.dayCol}], convenção=${schemaMeta.campaignDayTable.convention})`
                : (h.hasIndividualWeekdayCols
                    ? `Colunas individuais -> ${detectedDayCols}`
                    : (h.combinedWeekdayCol ? `Coluna combinada -> [${h.combinedWeekdayCol}]` : 'Nenhuma coluna/tabela de dia da semana detectada')))
        );
    }

    console.log(
        `🛡️  Modo de Resolução de Promoções: ${
            ignorePromotionCampaigns
                ? 'IGNORAR CAMPANHAS DA ABA PROMOÇÃO (usando apenas PREÇO PROM. da aba Estoque)'
                : 'VALIDAÇÃO ESTRITA (Data + Dia da Semana c/ menor preço entre Campanha hoje e Produto_Estoque)'
        }`
    );
    console.log('---------------------------------------------------\n');
}

/**
 * Monta expressão SQL booleana (1 ou 0) que verifica se uma coluna de dia da semana está marcada como ativa ('1', 'S', 'SIM', 'TRUE', 'T', 'Y', 'X').
 * Importante: Se o valor for NULL ou '0', retorna 0.
 */
function buildWeekdayColActiveExpr(alias, colName) {
    if (!colName) return '0';
    return `CASE WHEN UPPER(LTRIM(RTRIM(CAST(ISNULL(${alias}.[${colName}], '0') AS VARCHAR(10))))) IN ('1', 'S', 'SIM', 'TRUE', 'T', 'Y', 'X') THEN 1 ELSE 0 END`;
}

/**
 * Gera as cláusulas SQL de validação estrita de campanha ativa, dentro da validade (data inicial/final)
 * e válida para o DIA DA SEMANA ATUAL usando ((DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 2) % 7) (0=Seg..6=Dom).
 *
 * Regra segura de NULL para dias da semana:
 * - Se TODOS os dias da semana da campanha forem NULL (ou se não houver colunas de dia da semana), considera válida para todos os dias.
 * - Se PELO MENOS UM dia estiver marcado (= 1), trata NULL nos demais dias como 0 (inativo).
 */
function buildCampaignWhereConditions(alias, meta, hasBranchParam = false) {
    if (!meta) return [];
    const conds = [];

    // 1. Filial / Loja (se existir coluna de empresa/filial na tabela de promoção)
    if (hasBranchParam && meta.branchCol) {
        conds.push(`(${alias}.[${meta.branchCol}] IS NULL OR ${alias}.[${meta.branchCol}] = 0 OR CAST(${alias}.[${meta.branchCol}] AS VARCHAR(20)) = @branchCode)`);
    }

    // 2. Flags negativas (Eliminado, Cancelado, Inativo, Excluido, Encerrado)
    for (const negCol of meta.negativeInactiveCols || []) {
        conds.push(`UPPER(LTRIM(RTRIM(CAST(ISNULL(${alias}.[${negCol}], '0') AS VARCHAR(15))))) IN ('0', 'N', 'NAO', 'NÃO', 'FALSE', 'F', '')`);
    }

    // 3. Flags positivas (Ativo, Ativa)
    for (const posCol of meta.positiveActiveCols || []) {
        conds.push(`UPPER(LTRIM(RTRIM(CAST(ISNULL(${alias}.[${posCol}], '1') AS VARCHAR(15))))) IN ('1', 'S', 'SIM', 'TRUE', 'T', 'Y', 'A', 'ATIVO', 'ATIVA')`);
    }

    // 4. Status / Situação
    for (const stCol of meta.statusCols || []) {
        conds.push(`UPPER(LTRIM(RTRIM(CAST(ISNULL(${alias}.[${stCol}], '') AS VARCHAR(20))))) NOT IN ('I', 'C', 'E', 'B', 'N', 'FALSE', 'INATIVO', 'INATIVA', 'CANCELADO', 'CANCELADA', 'ENCERRADO', 'ENCERRADA', 'EXCLUIDO', 'FINALIZADO', 'FINALIZADA')`);
    }

    // 5. Datas de cancelamento / exclusão / encerramento
    for (const cDateCol of meta.cancelDateCols || []) {
        conds.push(`(${alias}.[${cDateCol}] IS NULL OR YEAR(${alias}.[${cDateCol}]) <= 1900)`);
    }

    // 6. Data Inicial e Data Final da campanha (comparando com CAST(GETDATE() AS DATE))
    if (meta.startDateCol) {
        conds.push(`(${alias}.[${meta.startDateCol}] IS NULL OR YEAR(${alias}.[${meta.startDateCol}]) <= 1900 OR @HojeData >= CAST(${alias}.[${meta.startDateCol}] AS DATE))`);
    }
    if (meta.endDateCol) {
        conds.push(`(${alias}.[${meta.endDateCol}] IS NULL OR (YEAR(${alias}.[${meta.endDateCol}]) > 1900 AND @HojeData <= CAST(${alias}.[${meta.endDateCol}] AS DATE)))`);
    }

    // 7. Validação estrita do DIA DA SEMANA ATUAL (@HojeDiaSemana: 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab, 6=Dom)
    // Regra segura contra NULL:
    // - Se TODOS os dias da semana forem NULL (allDaysNullExpr), a campanha não tem restrição de dia e vale todos os dias.
    // - Se PELO MENOS UM dia estiver marcado (= 1), qualquer outro dia com NULL ou 0 vale 0 (inativo).
    // - Se não houver todos NULL e também nenhum dia marcado (= 1), a campanha não está ativa para nenhum dia (0).
    if (meta.hasIndividualWeekdayCols) {
        const presentCols = Object.values(meta.weekdayCols).filter(Boolean);
        const allDaysNullExpr = presentCols.map(c => `${alias}.[${c}] IS NULL`).join(' AND ');
        const anyDayCheckedExpr = presentCols.map(c => `(${buildWeekdayColActiveExpr(alias, c)} = 1)`).join(' OR ');

        const todayCheckedCases = [];
        for (let dayIdx = 0; dayIdx <= 6; dayIdx++) {
            const colName = meta.weekdayCols[dayIdx];
            if (colName) {
                // Nunca usa ISNULL(col, 1): se for NULL, buildWeekdayColActiveExpr converte para '0' (inativo)
                todayCheckedCases.push(`WHEN ${dayIdx} THEN ${buildWeekdayColActiveExpr(alias, colName)}`);
            } else {
                // Se a coluna deste dia específico não existir mas outras colunas de dia existirem:
                // se algum outro dia estiver marcado (= 1), trata este dia como 0; senão 1.
                todayCheckedCases.push(`WHEN ${dayIdx} THEN CASE WHEN (${anyDayCheckedExpr}) THEN 0 ELSE 1 END`);
            }
        }

        conds.push(`(
            (${allDaysNullExpr})
            OR (
                (${anyDayCheckedExpr})
                AND (CASE @HojeDiaSemana ${todayCheckedCases.join(' ')} ELSE 0 END = 1)
            )
        )`);
    }

    if (meta.combinedWeekdayCol) {
        const cCol = `${alias}.[${meta.combinedWeekdayCol}]`;
        const strExpr = `UPPER(LTRIM(RTRIM(CAST(ISNULL(${cCol}, '') AS VARCHAR(100)))))`;
        conds.push(`(
            ${cCol} IS NULL
            OR ${strExpr} IN ('', 'TODOS', 'ALL', '1111111', 'SSSSSSS', '1234567', '0123456', '127')
            OR (
                CASE @HojeDiaSemana
                    WHEN 0 THEN CASE WHEN ${strExpr} LIKE '%SEG%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 1, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 1 THEN CASE WHEN ${strExpr} LIKE '%TER%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 2, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 2 THEN CASE WHEN ${strExpr} LIKE '%QUA%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 3, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 3 THEN CASE WHEN ${strExpr} LIKE '%QUI%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 4, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 4 THEN CASE WHEN ${strExpr} LIKE '%SEX%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 5, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 5 THEN CASE WHEN ${strExpr} LIKE '%SAB%' OR ${strExpr} LIKE '%SÁB%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 6, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    WHEN 6 THEN CASE WHEN ${strExpr} LIKE '%DOM%' OR (LEN(${strExpr}) = 7 AND SUBSTRING(${strExpr}, 7, 1) IN ('1', 'S', 'X')) THEN 1 ELSE 0 END
                    ELSE 0
                END = 1
            )
        )`);
    }

    // 8. Salvaguarda adicional por nome da campanha para campanhas nominais de dia específico (ex: "SEXTOU COM FORÇA")
    if (meta.nameCol) {
        const nameExpr = `UPPER(LTRIM(RTRIM(CAST(ISNULL(${alias}.[${meta.nameCol}], '') AS VARCHAR(200)))))`;
        conds.push(`(
            NOT (${nameExpr} LIKE '%SEXTOU%' OR ${nameExpr} LIKE '%SEXTA%')
            OR @HojeDiaSemana = 4
        )`);
    }

    return conds;
}

/**
 * Monta a query SQL completa do conector InovaFarma (sempre com SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED) que lê:
 * - PrecoVendaEstoque (PREÇO VENDA da aba Estoque)
 * - PrecoPromocaoEstoque (PREÇO PROM. da aba Estoque do próprio produto)
 * - PrecoCampanhaValidaHoje (menor preço de campanha da aba Promoção estritamente ativa hoje + dia da semana atual)
 * - PrecoPromocionalFinal (prioriza campanha válida hoje; se não houver nenhuma válida para hoje, usa obrigatoriamente o PREÇO PROM. do produto)
 */
function buildStrictInovaFarmaPriceQuery(schemaMeta, options = {}) {
    if (!schemaMeta || !schemaMeta.isInovaFarma) return null;

    const hasBranch = Boolean(options.branchCode);
    const p = schemaMeta.produto;
    const b = schemaMeta.branchStockTable;

    // 1. Expressão para PrecoVendaEstoque
    const prodSellingExpr = p.sellingPriceCol ? `ISNULL(CAST(p.[${p.sellingPriceCol}] AS DECIMAL(18, 2)), 0)` : '0';
    let finalSellingExpr = prodSellingExpr;
    if (b && b.sellingPriceCol) {
        finalSellingExpr = `CASE WHEN ISNULL(CAST(b.[${b.sellingPriceCol}] AS DECIMAL(18, 2)), 0) > 0 THEN CAST(b.[${b.sellingPriceCol}] AS DECIMAL(18, 2)) ELSE ${prodSellingExpr} END`;
    }

    // 2. Expressão para PrecoPromocaoEstoque (PREÇO PROM. da aba ESTOQUE / Produto_Estoque)
    let prodPromoRawExpr = p.promoPriceCol ? `ISNULL(CAST(p.[${p.promoPriceCol}] AS DECIMAL(18, 2)), 0)` : '0';
    const prodDateChecks = [];
    if (p.promoStartCol) {
        prodDateChecks.push(`(p.[${p.promoStartCol}] IS NULL OR YEAR(p.[${p.promoStartCol}]) <= 1900 OR @HojeData >= CAST(p.[${p.promoStartCol}] AS DATE))`);
    }
    if (p.promoEndCol) {
        prodDateChecks.push(`(p.[${p.promoEndCol}] IS NULL OR YEAR(p.[${p.promoEndCol}]) <= 1900 OR @HojeData <= CAST(p.[${p.promoEndCol}] AS DATE))`);
    }
    if (prodDateChecks.length > 0) {
        prodPromoRawExpr = `CASE WHEN ${prodDateChecks.join(' AND ')} THEN ${prodPromoRawExpr} ELSE 0 END`;
    }

    let finalStockPromoExpr = prodPromoRawExpr;
    if (b && b.promoPriceCol) {
        let branchPromoRaw = `ISNULL(CAST(b.[${b.promoPriceCol}] AS DECIMAL(18, 2)), 0)`;
        const branchDateChecks = [];
        if (b.promoStartCol) {
            branchDateChecks.push(`(b.[${b.promoStartCol}] IS NULL OR YEAR(b.[${b.promoStartCol}]) <= 1900 OR @HojeData >= CAST(b.[${b.promoStartCol}] AS DATE))`);
        }
        if (b.promoEndCol) {
            branchDateChecks.push(`(b.[${b.promoEndCol}] IS NULL OR YEAR(b.[${b.promoEndCol}]) <= 1900 OR @HojeData <= CAST(b.[${b.promoEndCol}] AS DATE))`);
        }
        if (
            b.offerStartCol &&
            b.offerEndCol &&
            b.offerStartCol !== b.promoStartCol &&
            b.offerEndCol !== b.promoEndCol &&
            b.offerFlagCol
        ) {
            branchDateChecks.push(
                `(ISNULL(CAST(b.[${b.offerFlagCol}] AS INT), 0) = 0 OR (` +
                `(b.[${b.offerStartCol}] IS NULL OR YEAR(b.[${b.offerStartCol}]) <= 1900 OR @HojeData >= CAST(b.[${b.offerStartCol}] AS DATE))` +
                ` AND (b.[${b.offerEndCol}] IS NULL OR YEAR(b.[${b.offerEndCol}]) <= 1900 OR @HojeData <= CAST(b.[${b.offerEndCol}] AS DATE))` +
                `))`
            );
        }
        if (branchDateChecks.length > 0) {
            branchPromoRaw = `CASE WHEN ${branchDateChecks.join(' AND ')} THEN ${branchPromoRaw} ELSE 0 END`;
        }
        finalStockPromoExpr = `CASE WHEN (${branchPromoRaw}) > 0 THEN (${branchPromoRaw}) ELSE (${prodPromoRawExpr}) END`;
    }

    // 3. Subquery OUTER APPLY para Campanhas da aba PROMOÇÃO válidas hoje (Data + Filial Promocao_Empresa + Dia da Semana Promocao_Dia*)
    let campaignOuterApplySql = `OUTER APPLY (SELECT CAST(NULL AS DECIMAL(18, 2)) AS PrecoCampanhaHoje) camp`;

    const buildExtraCampaignTableConds = (headerAlias, headerMeta) => {
        const extra = [];
        const cb = schemaMeta.campaignBranchTable;
        if (hasBranch && cb && cb.hasRows && headerMeta?.promoIdCol) {
            extra.push(`EXISTS (
                SELECT 1
                FROM dbo.[${cb.tableName}] pe WITH (NOLOCK)
                WHERE pe.[${cb.promoIdCol}] = ${headerAlias}.[${headerMeta.promoIdCol}]
                  AND LTRIM(RTRIM(CAST(pe.[${cb.branchCol}] AS VARCHAR(20)))) = @branchCode
            )`);
        }

        const cd = schemaMeta.campaignDayTable;
        if (cd && headerMeta?.promoIdCol) {
            // Se a campanha NÃO tiver registros em Promocao_Dia*, vale todos os dias da semana;
            // se tiver registros, só vale quando o dia atual (@HojeDiaTabela) constar na tabela.
            extra.push(`(
                NOT EXISTS (
                    SELECT 1
                    FROM dbo.[${cd.tableName}] pdAll WITH (NOLOCK)
                    WHERE pdAll.[${cd.promoIdCol}] = ${headerAlias}.[${headerMeta.promoIdCol}]
                )
                OR EXISTS (
                    SELECT 1
                    FROM dbo.[${cd.tableName}] pdToday WITH (NOLOCK)
                    WHERE pdToday.[${cd.promoIdCol}] = ${headerAlias}.[${headerMeta.promoIdCol}]
                      AND CAST(pdToday.[${cd.dayCol}] AS INT) = @HojeDiaTabela
                )
            )`);
        }
        return extra;
    };

    const cs = schemaMeta.campaignSource;
    if (cs) {
        if (cs.mode === 'header_detail' && cs.header && cs.item) {
            const h = cs.header;
            const i = cs.item;
            const whereConds = [
                `pi.[${i.prodIdCol}] = p.[${p.prodIdCol}]`,
                ...buildCampaignWhereConditions('pr', h, hasBranch),
                ...buildCampaignWhereConditions('pi', i, hasBranch),
                ...buildExtraCampaignTableConds('pr', h)
            ];

            let priceValExpr = '0';
            if (i.promoPriceCol) {
                priceValExpr = `ISNULL(CAST(pi.[${i.promoPriceCol}] AS DECIMAL(18, 2)), 0)`;
            } else if (h.promoPriceCol) {
                priceValExpr = `ISNULL(CAST(pr.[${h.promoPriceCol}] AS DECIMAL(18, 2)), 0)`;
            }

            if (i.discountPctCol) {
                priceValExpr = `CASE WHEN ${priceValExpr} > 0 THEN ${priceValExpr} WHEN ISNULL(CAST(pi.[${i.discountPctCol}] AS DECIMAL(18, 4)), 0) > 0 AND ISNULL(CAST(pi.[${i.discountPctCol}] AS DECIMAL(18, 4)), 0) < 100 THEN ROUND((${finalSellingExpr}) * (1.0 - (CAST(pi.[${i.discountPctCol}] AS DECIMAL(18, 4)) / 100.0)), 2) ELSE 0 END`;
            } else if (h.discountPctCol) {
                priceValExpr = `CASE WHEN ${priceValExpr} > 0 THEN ${priceValExpr} WHEN ISNULL(CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)), 0) > 0 AND ISNULL(CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)), 0) < 100 THEN ROUND((${finalSellingExpr}) * (1.0 - (CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)) / 100.0)), 2) ELSE 0 END`;
            }

            whereConds.push(`(${priceValExpr}) > 0`);

            campaignOuterApplySql = `
            OUTER APPLY (
                SELECT MIN(CAST(${priceValExpr} AS DECIMAL(18, 2))) AS PrecoCampanhaHoje
                FROM dbo.[${i.tableName}] pi WITH (NOLOCK)
                INNER JOIN dbo.[${h.tableName}] pr WITH (NOLOCK)
                    ON pr.[${h.promoIdCol}] = pi.[${i.joinCol}]
                WHERE ${whereConds.join('\n                  AND ')}
            ) camp`;
        } else if (cs.mode === 'single_table' && cs.header) {
            const h = cs.header;
            const whereConds = [
                `pr.[${h.prodIdCol}] = p.[${p.prodIdCol}]`,
                ...buildCampaignWhereConditions('pr', h, hasBranch),
                ...buildExtraCampaignTableConds('pr', h)
            ];

            let priceValExpr = h.promoPriceCol
                ? `ISNULL(CAST(pr.[${h.promoPriceCol}] AS DECIMAL(18, 2)), 0)`
                : '0';
            if (h.discountPctCol) {
                priceValExpr = `CASE WHEN ${priceValExpr} > 0 THEN ${priceValExpr} WHEN ISNULL(CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)), 0) > 0 AND ISNULL(CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)), 0) < 100 THEN ROUND((${finalSellingExpr}) * (1.0 - (CAST(pr.[${h.discountPctCol}] AS DECIMAL(18, 4)) / 100.0)), 2) ELSE 0 END`;
            }

            whereConds.push(`(${priceValExpr}) > 0`);

            campaignOuterApplySql = `
            OUTER APPLY (
                SELECT MIN(CAST(${priceValExpr} AS DECIMAL(18, 2))) AS PrecoCampanhaHoje
                FROM dbo.[${h.tableName}] pr WITH (NOLOCK)
                WHERE ${whereConds.join('\n                  AND ')}
            ) camp`;
        }
    }

    const branchJoinSql = b
        ? (hasBranch
            ? `LEFT JOIN dbo.[${b.tableName}] b WITH (NOLOCK) ON b.[${b.prodIdCol}] = p.[${p.prodIdCol}] AND LTRIM(RTRIM(CAST(b.[${b.branchCol}] AS VARCHAR(20)))) = @branchCode`
            : `OUTER APPLY (SELECT TOP 1 * FROM dbo.[${b.tableName}] b0 WITH (NOLOCK) WHERE b0.[${b.prodIdCol}] = p.[${p.prodIdCol}] ORDER BY b0.[${b.branchCol}] ASC) b`)
        : '';

    // Convenção da tabela Promocao_Dia*:
    // - '0_sun_6_sat': 0=Dom .. 6=Sáb
    // - '1_mon_7_sun': 1=Seg .. 7=Dom (ISO)
    // - '1_sun_7_sat' (padrão SQL DATEPART): 1=Dom .. 7=Sáb
    const dayConvention = schemaMeta.campaignDayTable?.convention || '1_sun_7_sat';
    let diaTabelaExpr = '(((DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 1) % 7) + 1)';
    if (dayConvention === '0_sun_6_sat') {
        diaTabelaExpr = '((DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 1) % 7)';
    } else if (dayConvention === '1_mon_7_sun') {
        diaTabelaExpr = '(((DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 2) % 7) + 1)';
    }

    const campValidExpr = `camp.PrecoCampanhaHoje IS NOT NULL AND camp.PrecoCampanhaHoje > 0 AND camp.PrecoCampanhaHoje < (${finalSellingExpr})`;
    const stockValidExpr = `(${finalStockPromoExpr}) > 0 AND (${finalStockPromoExpr}) < (${finalSellingExpr})`;

    return `
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SET NOCOUNT ON;

        DECLARE @HojeData DATE = CAST(GETDATE() AS DATE);
        -- Cálculo independente de DATEFIRST: 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab, 6=Dom
        DECLARE @HojeDiaSemana INT = ((DATEPART(WEEKDAY, GETDATE()) + @@DATEFIRST - 2) % 7);
        -- Dia na convenção da tabela Promocao_Dia* (${dayConvention})
        DECLARE @HojeDiaTabela INT = ${diaTabelaExpr};

        SELECT
            p.[${p.prodIdCol}] AS CodigoProduto,
            CAST(${finalSellingExpr} AS DECIMAL(18, 2)) AS PrecoVendaEstoque,
            CASE
                WHEN ${stockValidExpr}
                    THEN CAST(${finalStockPromoExpr} AS DECIMAL(18, 2))
                ELSE NULL
            END AS PrecoPromocaoEstoque,
            CASE
                WHEN @IgnorePromotionCampaigns = 1 THEN NULL
                WHEN ${campValidExpr}
                    THEN CAST(camp.PrecoCampanhaHoje AS DECIMAL(18, 2))
                ELSE NULL
            END AS PrecoCampanhaValidaHoje,
            CASE
                WHEN @IgnorePromotionCampaigns = 1 THEN
                    CASE
                        WHEN ${stockValidExpr}
                            THEN CAST(${finalStockPromoExpr} AS DECIMAL(18, 2))
                        ELSE NULL
                    END
                WHEN (${campValidExpr}) AND (${stockValidExpr}) THEN
                    CASE
                        WHEN camp.PrecoCampanhaHoje <= (${finalStockPromoExpr})
                            THEN CAST(camp.PrecoCampanhaHoje AS DECIMAL(18, 2))
                        ELSE CAST(${finalStockPromoExpr} AS DECIMAL(18, 2))
                    END
                WHEN ${campValidExpr}
                    THEN CAST(camp.PrecoCampanhaHoje AS DECIMAL(18, 2))
                WHEN ${stockValidExpr}
                    THEN CAST(${finalStockPromoExpr} AS DECIMAL(18, 2))
                ELSE NULL
            END AS PrecoPromocionalFinal
        FROM dbo.[${p.tableName}] p WITH (NOLOCK)
        ${branchJoinSql}
        ${campaignOuterApplySql};
    `;
}

/**
 * Aplica a validação estrita de promoções por data + dia da semana (ou a opção de ignorar campanhas da aba Promoção)
 * sobre todos os registros lidos da View do InovaFarma, garantindo que campanhas de outros dias da semana
 * (como "SEXTOU COM FORÇA" na segunda-feira) NUNCA sobrescrevam o "PREÇO PROM." da aba Estoque.
 */
async function applyInovaFarmaStrictPromotionRules(pool, rawRecords, options = {}) {
    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
        return rawRecords;
    }

    try {
        const ignorePromotionCampaigns = resolveIgnorePromotionCampaignsFlag(options.dbConfig, options);

        if (!options.connectorInstance?._cachedInovaPromoSchema) {
            const schemaMeta = await inspectInovaFarmaSchema(pool);
            if (options.connectorInstance) {
                options.connectorInstance._cachedInovaPromoSchema = schemaMeta;
            }
            if (!options.connectorInstance?._hasLoggedInovaSchemaDiag) {
                logInovaFarmaSchemaDetection(schemaMeta, ignorePromotionCampaigns);
                if (options.connectorInstance) {
                    options.connectorInstance._hasLoggedInovaSchemaDiag = true;
                }
            }
        }

        const schemaMeta = options.connectorInstance?._cachedInovaPromoSchema || await inspectInovaFarmaSchema(pool);
        if (!schemaMeta || !schemaMeta.isInovaFarma) {
            return rawRecords;
        }

        const querySql = buildStrictInovaFarmaPriceQuery(schemaMeta, {
            branchCode: options.branchCode
        });
        if (!querySql) {
            return rawRecords;
        }

        const req = pool.request();
        req.input('IgnorePromotionCampaigns', sql.Bit, ignorePromotionCampaigns ? 1 : 0);
        if (options.branchCode) {
            req.input('branchCode', sql.VarChar(20), String(options.branchCode).trim());
        }

        const priceRes = await req.query(querySql);
        const priceRows = priceRes?.recordset || [];
        if (priceRows.length === 0) {
            return rawRecords;
        }

        const priceByCodigoMap = new Map();
        for (const pr of priceRows) {
            const cod = Number(pr.CodigoProduto);
            if (Number.isInteger(cod) && cod > 0) {
                priceByCodigoMap.set(cod, {
                    precoVendaEstoque: roundMoney(pr.PrecoVendaEstoque),
                    precoPromocaoEstoque: pr.PrecoPromocaoEstoque !== null && pr.PrecoPromocaoEstoque !== undefined
                        ? roundMoney(pr.PrecoPromocaoEstoque)
                        : null,
                    precoCampanhaValidaHoje: pr.PrecoCampanhaValidaHoje !== null && pr.PrecoCampanhaValidaHoje !== undefined
                        ? roundMoney(pr.PrecoCampanhaValidaHoje)
                        : null,
                    precoPromocionalFinal: pr.PrecoPromocionalFinal !== null && pr.PrecoPromocionalFinal !== undefined
                        ? roundMoney(pr.PrecoPromocionalFinal)
                        : null
                });
            }
        }

        if (!options.connectorInstance?._hasLoggedPromoRuleSummary) {
            const cs = schemaMeta.campaignSource;
            const cd = schemaMeta.campaignDayTable;
            const weekdayInfo = cd
                ? `Tabela dbo.${cd.tableName} (${cd.dayCol}, ${cd.convention})`
                : (cs
                    ? (cs.header?.hasIndividualWeekdayCols
                        ? `Flags Seg..Dom (${Object.values(cs.header.weekdayCols).filter(Boolean).join(', ')})`
                        : (cs.header?.combinedWeekdayCol ? `Coluna ${cs.header.combinedWeekdayCol}` : 'Filtro nominal + datas'))
                    : 'Apenas Preço Prom. da aba Estoque');
            console.log(
                `[InovaFarma Promo Filter] Regra estrita ativa (Ignorar Campanhas=${ignorePromotionCampaigns ? 'SIM' : 'NÃO'} | ` +
                `Controle Dias da Semana: ${weekdayInfo} | ${priceByCodigoMap.size} produtos verificados via READ UNCOMMITTED).`
            );
            if (options.connectorInstance) {
                options.connectorInstance._hasLoggedPromoRuleSummary = true;
            }
        }

        for (const row of rawRecords) {
            if (!row || typeof row !== 'object') continue;
            const bc = extractBarcode(row);
            const rawCode =
                getFieldIgnoreCase(row, [
                    'CodigoProduto', 'codigo_produto', 'cod_produto', 'codigo_interno', 'cod_interno',
                    'id_produto', 'ID_PRODUTO', 'codigo', 'CODIGO', 'internal_code'
                ]) || extractInternalCode(row, bc);

            const codNum = Number(String(rawCode || '').trim());
            if (!Number.isInteger(codNum) || codNum <= 0) continue;

            const strictPrices = priceByCodigoMap.get(codNum);
            if (!strictPrices) continue;

            const { precoVendaEstoque, precoPromocionalFinal } = strictPrices;
            const validPromo =
                precoPromocionalFinal !== null &&
                precoPromocionalFinal > 0 &&
                (precoVendaEstoque <= 0 || precoPromocionalFinal < precoVendaEstoque)
                    ? precoPromocionalFinal
                    : null;

            // Garante que o preço de venda base (PREÇO VENDA da aba Estoque) não seja sobrescrito pelo preço da campanha
            if (precoVendaEstoque > 0) {
                row.PrecoVenda = precoVendaEstoque;
                row.preco_venda = precoVendaEstoque;
                row.Preco_Bruto = precoVendaEstoque;
                row.preco_bruto = precoVendaEstoque;
                row.price = precoVendaEstoque;
            }

            // Sobrescreve todos os campos de preço promocional/líquido com o valor validado para HOJE (ou PREÇO PROM. da aba Estoque)
            const promoFieldsToSync = [
                'preco_promocional', 'Preco_Promocional', 'PRECO_PROMOCIONAL',
                'PrecoPromocao', 'preco_promocao', 'PRECO_PROMOCAO',
                'promotional_price', 'promotionalPrice',
                'vl_promocao', 'Vl_Promocao', 'VL_PROMOCAO',
                'Vlr_Promocao', 'vlr_promocao', 'VLR_PROMOCAO',
                'preco_oferta', 'Preco_Oferta', 'PRECO_OFERTA',
                'preco_por', 'Preco_Por', 'PRECO_POR',
                'valor_promocional', 'Valor_Promocional', 'VALOR_PROMOCIONAL',
                'promo_price', 'preco_promo', 'promocional'
            ];
            for (const field of promoFieldsToSync) {
                if (field in row || field === 'preco_promocional' || field === 'promotional_price' || field === 'PrecoPromocao') {
                    row[field] = validPromo;
                }
            }

            const liquidPrice = validPromo !== null ? validPromo : (precoVendaEstoque > 0 ? precoVendaEstoque : row.Preco_Liquido);
            const liquidFieldsToSync = [
                'Preco_Liquido', 'preco_liquido', 'PRECO_LIQUIDO',
                'PrecoLiquido', 'precoLiquido', 'PRECOLIQUIDO',
                'Vl_Liquido', 'vl_liquido', 'VL_LIQUIDO',
                'Vlr_Liquido', 'vlr_liquido', 'VLR_LIQUIDO',
                'Pr_Liquido', 'pr_liquido', 'PR_LIQUIDO'
            ];
            for (const liqField of liquidFieldsToSync) {
                if (liqField in row || liqField === 'Preco_Liquido') {
                    row[liqField] = liquidPrice;
                }
            }

            // Sinaliza ao priceNormalizer que a promoção já foi validada/zerada estritamente pelo resolvedor
            row._promoRuleValidated = true;
        }

        return rawRecords;
    } catch (err) {
        console.warn(`[InovaFarma Promo Filter] Aviso ao validar promoções por dia da semana (mantendo fallback da View): ${err.message}`);
        return rawRecords;
    }
}

module.exports = {
    resolveIgnorePromotionCampaignsFlag,
    inspectInovaFarmaSchema,
    logInovaFarmaSchemaDetection,
    buildStrictInovaFarmaPriceQuery,
    applyInovaFarmaStrictPromotionRules
};
