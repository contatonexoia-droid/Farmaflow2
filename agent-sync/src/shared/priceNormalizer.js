/**
 * Converte valores numéricos ou strings formatadas (ex: "19,90" ou "1.234,56") em float seguro.
 */
function parsePriceValue(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : 0;
    }
    let str = String(val).trim();
    if (!str) return 0;
    str = str.replace(/[^\d.,-]/g, '');
    if (!str) return 0;

    if (str.includes(',') && str.includes('.')) {
        if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }

    const parsed = parseFloat(str);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normaliza o nome de uma coluna removendo acentos, pontos, espaços, traços e underscores.
 * Ex: "Vl. PMC" -> "vlpmc", "Cód. Item" -> "coditem", "Código_Interno" -> "codigointerno"
 */
function normalizeColKey(key) {
    return String(key || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Busca o valor de uma chave no objeto (com fallback case-insensitive e ignorando acentos/pontos/espaços).
 */
function getFieldIgnoreCase(record, keys) {
    if (!record || typeof record !== 'object') return undefined;

    // 1. Busca exata
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') {
            return record[key];
        }
    }

    // 2. Busca case-insensitive e normalizada (sem pontos/espaços/acentos)
    const lowerMap = {};
    const normMap = {};
    for (const k of Object.keys(record)) {
        const val = record[k];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
            lowerMap[k.toLowerCase().trim()] = val;
            const nk = normalizeColKey(k);
            if (nk && normMap[nk] === undefined) {
                normMap[nk] = val;
            }
        }
    }

    for (const key of keys) {
        const lowerKey = key.toLowerCase().trim();
        if (Object.prototype.hasOwnProperty.call(lowerMap, lowerKey)) {
            return lowerMap[lowerKey];
        }
        const normKey = normalizeColKey(key);
        if (normKey && Object.prototype.hasOwnProperty.call(normMap, normKey)) {
            return normMap[normKey];
        }
    }

    return undefined;
}

/**
 * Retorna o primeiro valor de preço positivo (> 0) dentre uma lista de possíveis nomes de colunas,
 * suportando variações com ponto/espaço/acento (ex: "Vl. PMC", "Vl_PMC", "Vlr_PMC") e regex opcional nas chaves.
 */
function pickFirstPositivePrice(record, keys, keyRegexFallback = null) {
    if (!record || typeof record !== 'object') return 0;

    // 1. Busca direta nas chaves exatas
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            const val = parsePriceValue(record[key]);
            if (val > 0) return val;
        }
    }

    // 2. Mapa normalizado (case-insensitive e sem pontuação/espaços)
    const lowerMap = {};
    const normMap = {};
    for (const k of Object.keys(record)) {
        lowerMap[k.toLowerCase().trim()] = record[k];
        const nk = normalizeColKey(k);
        if (nk && normMap[nk] === undefined) {
            normMap[nk] = record[k];
        }
    }

    for (const key of keys) {
        const lowerKey = key.toLowerCase().trim();
        if (Object.prototype.hasOwnProperty.call(lowerMap, lowerKey)) {
            const val = parsePriceValue(lowerMap[lowerKey]);
            if (val > 0) return val;
        }
        const normKey = normalizeColKey(key);
        if (normKey && Object.prototype.hasOwnProperty.call(normMap, normKey)) {
            const val = parsePriceValue(normMap[normKey]);
            if (val > 0) return val;
        }
    }

    // 3. Fallback por Regex no nome da coluna (ex: qualquer coluna que contenha "pmc", "original", "tabela", "maximo")
    if (keyRegexFallback instanceof RegExp) {
        for (const k of Object.keys(record)) {
            const normK = normalizeColKey(k);
            if (keyRegexFallback.test(k) || keyRegexFallback.test(normK)) {
                const val = parsePriceValue(record[k]);
                if (val > 0) return val;
            }
        }
    }

    return 0;
}

/**
 * Extrai e higieniza o código de barras (EAN) do registro.
 */
function extractBarcode(record) {
    const rawBarcode = getFieldIgnoreCase(record, [
        'codigo_barras',
        'cod_barras',
        'codbarras',
        'cd_barras',
        'cdbarras',
        'codigo_barra',
        'cod_barra',
        'codigo_de_barras',
        'EAN',
        'ean',
        'ean13',
        'ean_produto',
        'gtin',
        'CodigoBarras',
        'COD_BARRAS',
        'BARRAS',
        'barras',
        'barcode'
    ]);

    if (rawBarcode === undefined || rawBarcode === null) return '';
    const str = String(rawBarcode).trim();
    if (!str) return '';
    const digits = str.replace(/\D/g, '');
    return digits || str;
}

/**
 * Extrai o código interno real do produto no Siagold (ex: "20325" / "020325"),
 * garantindo que NÃO seja confundido com o código de barras (EAN), a menos que não exista outra coluna.
 */
function extractInternalCode(record, barcode = '') {
    if (!record || typeof record !== 'object') return '';

    const candidateKeys = [
        'internal_code',
        'codigo_interno',
        'cod_interno',
        'codigointerno',
        'cod_item',
        'COD_ITEM',
        'Cod_Item',
        'codigo_item',
        'Codigo_Item',
        'cd_item',
        'id_item',
        'ID_Item',
        'Id_Item',
        'codigo_produto',
        'cod_produto',
        'Cod_Produto',
        'cod_prod',
        'Cod_Prod',
        'cd_produto',
        'Cd_Produto',
        'cd_prod',
        'id_produto',
        'ID_PRODUTO',
        'Id_do_produto',
        'codigo',
        'Codigo',
        'CODIGO',
        'código',
        'Código',
        'cod',
        'Cod',
        'COD',
        'referencia',
        'Referencia',
        'ref',
        'Ref',
        'sku',
        'SKU',
        'id_do_sku',
        'id'
    ];

    const cleanBarcode = String(barcode || '').trim();
    let fallbackSameAsBarcode = '';

    // 1. Verifica nas chaves candidatas em ordem de prioridade
    for (const key of candidateKeys) {
        const val = getFieldIgnoreCase(record, [key]);
        if (val !== undefined && val !== null) {
            const cleanVal = String(val).trim();
            if (!cleanVal) continue;
            if (cleanBarcode && cleanVal === cleanBarcode) {
                if (!fallbackSameAsBarcode) fallbackSameAsBarcode = cleanVal;
                continue;
            }
            return cleanVal;
        }
    }

    // 2. Varredura em todas as colunas do registro procurando qualquer chave de código/item/ref que não seja barra/ean/filial
    for (const k of Object.keys(record)) {
        const normK = normalizeColKey(k);
        if (!normK) continue;
        if (normK.includes('barra') || normK.includes('ean') || normK.includes('gtin') || normK.includes('filial') || normK.includes('cest') || normK.includes('ncm')) {
            continue;
        }
        if (
            normK.startsWith('cod') ||
            normK.startsWith('cd') ||
            normK.includes('item') ||
            normK.includes('prod') ||
            normK.includes('interno') ||
            normK === 'id' ||
            normK === 'sku' ||
            normK.startsWith('ref')
        ) {
            const rawVal = record[k];
            if (rawVal !== undefined && rawVal !== null) {
                const cleanVal = String(rawVal).trim();
                if (!cleanVal) continue;
                if (cleanBarcode && cleanVal === cleanBarcode) {
                    if (!fallbackSameAsBarcode) fallbackSameAsBarcode = cleanVal;
                    continue;
                }
                return cleanVal;
            }
        }
    }

    return fallbackSameAsBarcode || cleanBarcode || '';
}

/**
 * Identifica e normaliza o campo de estoque do produto.
 * Se vier negativo (< 0) ou inválido, converte para 0.
 */
function parseStockValue(record) {
    const rawStock = getFieldIgnoreCase(record, [
        'estoque',
        'Estoque_Atual',
        'estoque_atual',
        'EstoqueAtual',
        'Qtd_Estoque',
        'qtd_estoque',
        'QTD_ESTOQUE',
        'saldo',
        'Saldo_Estoque',
        'saldo_estoque',
        'SALDO_ESTOQUE',
        'quantidade',
        'Quantidade_do_estoque',
        'quantidade_do_estoque',
        'QUANTIDADE',
        'ESTOQUE',
        'stock',
        'estoque_disponivel',
        'qtd'
    ]);

    if (rawStock === undefined || rawStock === null || rawStock === '') {
        return 0;
    }

    const parsed = parsePriceValue(rawStock);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.floor(parsed);
}

/**
 * Identifica campos de status/ativo na view (ativo, Ativo, situacao, Situacao, status, bloqueado, inativo).
 * Retorna false se o produto estiver explicitamente inativo/bloqueado; caso contrário, retorna true.
 */
function parseActiveStatus(record) {
    if (!record || typeof record !== 'object') return true;

    const rawBlockedOrInactive = getFieldIgnoreCase(record, [
        'bloqueado',
        'Bloqueado',
        'BLOQUEADO',
        'inativo',
        'Inativo',
        'INATIVO',
        'excluido',
        'Excluido',
        'EXCLUIDO'
    ]);

    if (rawBlockedOrInactive !== undefined) {
        if (rawBlockedOrInactive === true || rawBlockedOrInactive === 1) return false;
        const normBlocked = String(rawBlockedOrInactive).trim().toUpperCase();
        if (['1', 'S', 'SIM', 'TRUE', 'Y', 'YES', 'T', 'BLOQUEADO', 'INATIVO'].includes(normBlocked)) {
            return false;
        }
    }

    const rawActiveOrStatus = getFieldIgnoreCase(record, [
        'active',
        'ativo',
        'Ativo',
        'ATIVO',
        'situacao',
        'Situacao',
        'SITUACAO',
        'status',
        'Status',
        'STATUS',
        'st_ativo',
        'fl_ativo'
    ]);

    if (rawActiveOrStatus !== undefined) {
        if (rawActiveOrStatus === false || rawActiveOrStatus === 0) return false;
        const normActive = String(rawActiveOrStatus)
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if ([
            '0',
            'N',
            'NAO',
            'FALSE',
            'F',
            'I',
            'INATIVO',
            'B',
            'BLOQUEADO',
            'C',
            'CANCELADO',
            'D',
            'DESATIVADO',
            'E',
            'EXCLUIDO',
            'SUSPENSO'
        ].includes(normActive)) {
            return false;
        }
    }

    return true;
}

/**
 * Normaliza e higieniza preços, código interno, código de barras, estoque e status
 * de um registro vindo da view vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW:
 * 1. Extrai internal_code real (Cod_Item, Cod_Produto, Codigo, etc.) garantindo que não seja sobrescrito pelo EAN.
 * 2. Extrai original_price / PMC (Vl_PMC, Vl. PMC, Valor_PMC, Vlr_PMC, Preco_PMC, PMC, Preco_Tabela, etc.).
 * 3. Se preco_venda vier <= 0 ou null, assume original_price / PMC.
 * 4. Normaliza estoque (negativo -> 0) e status ativo/inativo.
 */
function normalizeAndSanitizeSiagoldRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const normalizedStock = parseStockValue(raw);
    const isActive = parseActiveStatus(raw);
    const extractedBarcode = extractBarcode(raw);
    const extractedInternalCode = extractInternalCode(raw, extractedBarcode);

    const rawSellingPrice = pickFirstPositivePrice(raw, [
        'preco_venda',
        'Preco_Venda',
        'PRECO_VENDA',
        'Vl_Venda',
        'vl_venda',
        'VL_VENDA',
        'Vlr_Venda',
        'vlr_venda',
        'Valor_Venda',
        'valor_venda',
        'Preco_Bruto',
        'preco_bruto',
        'PRECO_BRUTO',
        'PrecoVenda',
        'preco',
        'Preco',
        'PRECO',
        'price',
        'Pr_Venda',
        'pr_venda',
        'Venda',
        'venda'
    ]);

    const rawOriginalPrice = pickFirstPositivePrice(
        raw,
        [
            'Vl_PMC',
            'vl_pmc',
            'VL_PMC',
            'Vl. PMC',
            'VlPMC',
            'vlpmc',
            'Valor_PMC',
            'valor_pmc',
            'VALOR_PMC',
            'Vlr_PMC',
            'vlr_pmc',
            'VLR_PMC',
            'Vlr. PMC',
            'Preco_PMC',
            'preco_pmc',
            'PRECO_PMC',
            'Pr_PMC',
            'pr_pmc',
            'PMC',
            'pmc',
            'Preco_Consumidor',
            'preco_consumidor',
            'Vl_Consumidor',
            'vl_consumidor',
            'Preco_Maximo',
            'preco_maximo',
            'Vl_Tabela',
            'vl_tabela',
            'Preco_Tabela',
            'preco_tabela',
            'PRECO_TABELA',
            'preco_original',
            'Preco_Original',
            'PRECO_ORIGINAL',
            'original_price',
            'valor_original',
            'Preco_Fabrica',
            'preco_fabrica',
            'Pr_Fabrica',
            'pr_fabrica'
        ],
        /(pmc|original|tabela|maximo|consumidor)/i
    );

    const rawLiquidOrPromoPrice = pickFirstPositivePrice(raw, [
        'Preco_Liquido',
        'preco_liquido',
        'PRECO_LIQUIDO',
        'Vl_Liquido',
        'vl_liquido',
        'Vlr_Liquido',
        'vlr_liquido',
        'preco_promocional',
        'Preco_Promocional',
        'PRECO_PROMOCIONAL',
        'Vl_Promocao',
        'vl_promocao',
        'Vlr_Promocao',
        'vlr_promocao',
        'PrecoPromocao',
        'preco_oferta',
        'promotional_price',
        'Pr_Liquido',
        'pr_liquido'
    ]);

    // Ignorar/filtrar apenas registros onde TODOS os campos de preço sejam <= 0
    if (rawSellingPrice <= 0 && rawOriginalPrice <= 0 && rawLiquidOrPromoPrice <= 0) {
        return null;
    }

    // Se preco_venda / Preco_Bruto vier <= 0 ou null, preenche automaticamente com Preço Original / PMC
    let baseSellingPrice = rawSellingPrice;
    let usedOriginalFallback = false;

    if (baseSellingPrice <= 0) {
        if (rawOriginalPrice > 0) {
            baseSellingPrice = rawOriginalPrice;
            usedOriginalFallback = true;
        } else if (rawLiquidOrPromoPrice > 0) {
            baseSellingPrice = rawLiquidOrPromoPrice;
        }
    }

    // No Siagold, quando "Venda" é 21,99 e "Vl. PMC" é 24,70:
    // price = 21.99 e original_price (PMC) = 24.70.
    let finalOriginalPrice = rawOriginalPrice > 0 ? rawOriginalPrice : baseSellingPrice;
    let finalPromoPrice = null;

    if (rawSellingPrice > 0 && rawLiquidOrPromoPrice > rawSellingPrice) {
        // Caso invertido no ERP (Preco_Liquido maior que Preco_Bruto)
        baseSellingPrice = rawLiquidOrPromoPrice;
        finalPromoPrice = rawSellingPrice;
        if (finalOriginalPrice < baseSellingPrice) {
            finalOriginalPrice = baseSellingPrice;
        }
    } else if (rawLiquidOrPromoPrice > 0 && rawLiquidOrPromoPrice < baseSellingPrice) {
        finalPromoPrice = rawLiquidOrPromoPrice;
    }

    // Se a coluna Preco_Bruto na view for maior que o preço de venda líquido e rawOriginalPrice estava vazio, usa como original_price
    const rawBrutoExplicit = pickFirstPositivePrice(raw, ['Preco_Bruto', 'preco_bruto', 'PRECO_BRUTO', 'Vl_Bruto', 'vl_bruto']);
    if (rawOriginalPrice <= 0 && rawBrutoExplicit > baseSellingPrice) {
        finalOriginalPrice = rawBrutoExplicit;
    }

    const normalizedPrice = Number(baseSellingPrice.toFixed(2));
    const normalizedOriginal = Number(finalOriginalPrice.toFixed(2));
    const normalizedPromo = finalPromoPrice && finalPromoPrice > 0 && finalPromoPrice < normalizedPrice
        ? Number(finalPromoPrice.toFixed(2))
        : null;

    const effectiveStock = isActive ? normalizedStock : 0;

    const result = {
        ...raw,
        stock: effectiveStock,
        estoque: effectiveStock,
        active: isActive,
        ativo: isActive,
        price: normalizedPrice,
        preco_venda: normalizedPrice,
        Preco_Bruto: normalizedPrice,
        original_price: normalizedOriginal,
        preco_original: normalizedOriginal,
        pmc: normalizedOriginal,
        PMC: normalizedOriginal,
        Vl_PMC: normalizedOriginal,
        promotional_price: normalizedPromo,
        preco_promocional: normalizedPromo,
        Preco_Liquido: normalizedPromo !== null ? normalizedPromo : normalizedPrice,
        _priceFallbackApplied: usedOriginalFallback
    };

    if (extractedBarcode) {
        result.barcode = extractedBarcode;
        result.ean = extractedBarcode;
        result.codigo_barras = extractedBarcode;
    }

    if (extractedInternalCode) {
        result.internal_code = extractedInternalCode;
        result.codigo_interno = extractedInternalCode;
        result.codigo = extractedInternalCode;
        result.sku = extractedInternalCode;
    }

    return result;
}

module.exports = {
    parsePriceValue,
    parseStockValue,
    parseActiveStatus,
    pickFirstPositivePrice,
    getFieldIgnoreCase,
    normalizeColKey,
    extractBarcode,
    extractInternalCode,
    normalizeAndSanitizeSiagoldRecord
};
