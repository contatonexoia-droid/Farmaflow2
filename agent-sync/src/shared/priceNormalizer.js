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
 * Busca o valor de uma chave no objeto (com fallback case-insensitive).
 */
function getFieldIgnoreCase(record, keys) {
    if (!record || typeof record !== 'object') return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined && record[key] !== null && record[key] !== '') {
            return record[key];
        }
    }
    const lowerMap = {};
    for (const k of Object.keys(record)) {
        lowerMap[k.toLowerCase()] = record[k];
    }
    for (const key of keys) {
        const lowerKey = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(lowerMap, lowerKey) && lowerMap[lowerKey] !== undefined && lowerMap[lowerKey] !== null && lowerMap[lowerKey] !== '') {
            return lowerMap[lowerKey];
        }
    }
    return undefined;
}

/**
 * Retorna o primeiro valor de preço positivo (> 0) dentre uma lista de possíveis nomes de colunas.
 */
function pickFirstPositivePrice(record, keys) {
    if (!record || typeof record !== 'object') return 0;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            const val = parsePriceValue(record[key]);
            if (val > 0) return val;
        }
    }
    const lowerMap = {};
    for (const k of Object.keys(record)) {
        lowerMap[k.toLowerCase()] = record[k];
    }
    for (const key of keys) {
        const lowerKey = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(lowerMap, lowerKey)) {
            const val = parsePriceValue(lowerMap[lowerKey]);
            if (val > 0) return val;
        }
    }
    return 0;
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

    // 1. Verifica flags de bloqueio / inatividade explícita (bloqueado, inativo)
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

    // 2. Verifica flags de ativo / situação / status
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
 * Normaliza e higieniza preços, estoque e status de um registro vindo da view vw_FarmaFlow_Itens / VW_INTEGRACAO_FARMAFLOW:
 * 1. Normaliza estoque (se negativo, converte para 0) e status de ativo (active: true/false).
 * 2. Se preco_venda / Preco_Bruto / preco vier <= 0 ou null, assume preco_original / PMC / preco_tabela.
 * 3. Se houver Preco_Liquido / preco_promocional válido (> 0 e < preço base), mapeia como promocional.
 * 4. Retorna null se TODOS os campos de preço forem <= 0.
 */
function normalizeAndSanitizeSiagoldRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const normalizedStock = parseStockValue(raw);
    const isActive = parseActiveStatus(raw);

    const rawSellingPrice = pickFirstPositivePrice(raw, [
        'preco_venda',
        'Preco_Venda',
        'PRECO_VENDA',
        'Preco_Bruto',
        'preco_bruto',
        'PRECO_BRUTO',
        'PrecoVenda',
        'preco',
        'Preco',
        'PRECO',
        'price',
        'valor_venda',
        'vl_venda',
        'Pr_Venda',
        'pr_venda'
    ]);

    const rawOriginalPrice = pickFirstPositivePrice(raw, [
        'preco_original',
        'Preco_Original',
        'PRECO_ORIGINAL',
        'PMC',
        'pmc',
        'preco_pmc',
        'Preco_PMC',
        'PRECO_PMC',
        'preco_tabela',
        'Preco_Tabela',
        'PRECO_TABELA',
        'original_price',
        'Preco_Maximo',
        'preco_maximo',
        'Pr_Fabrica',
        'pr_fabrica'
    ]);

    const rawLiquidOrPromoPrice = pickFirstPositivePrice(raw, [
        'Preco_Liquido',
        'preco_liquido',
        'PRECO_LIQUIDO',
        'preco_promocional',
        'Preco_Promocional',
        'PRECO_PROMOCIONAL',
        'PrecoPromocao',
        'preco_oferta',
        'promotional_price',
        'vl_promocao',
        'Pr_Liquido',
        'pr_liquido'
    ]);

    // Regra: Ignorar/filtrar apenas registros onde TODOS os campos de preço sejam <= 0
    if (rawSellingPrice <= 0 && rawOriginalPrice <= 0 && rawLiquidOrPromoPrice <= 0) {
        return null;
    }

    // Regra: Se preco_venda / Preco_Bruto vier <= 0 ou null, preenche automaticamente com Preço Original / PMC
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

    // Tratamento de Preco_Liquido / promocional evitando preços invertidos
    let finalOriginalPrice = rawOriginalPrice > 0 ? rawOriginalPrice : baseSellingPrice;
    let finalPromoPrice = null;

    if (rawSellingPrice > 0 && rawLiquidOrPromoPrice > rawSellingPrice) {
        baseSellingPrice = rawLiquidOrPromoPrice;
        finalPromoPrice = rawSellingPrice;
        if (finalOriginalPrice < baseSellingPrice) {
            finalOriginalPrice = baseSellingPrice;
        }
    } else if (rawLiquidOrPromoPrice > 0 && rawLiquidOrPromoPrice < baseSellingPrice) {
        finalPromoPrice = rawLiquidOrPromoPrice;
    }

    if (finalOriginalPrice < baseSellingPrice) {
        finalOriginalPrice = baseSellingPrice;
    }

    const normalizedPrice = Number(baseSellingPrice.toFixed(2));
    const normalizedOriginal = Number(finalOriginalPrice.toFixed(2));
    const normalizedPromo = finalPromoPrice && finalPromoPrice > 0 && finalPromoPrice < normalizedPrice
        ? Number(finalPromoPrice.toFixed(2))
        : null;

    // Se o produto estiver explicitamente inativo, força stock = 0 caso seja enviado em sincronização incremental
    const effectiveStock = isActive ? normalizedStock : 0;

    return {
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
        PMC: normalizedOriginal,
        promotional_price: normalizedPromo,
        preco_promocional: normalizedPromo,
        Preco_Liquido: normalizedPromo !== null ? normalizedPromo : normalizedPrice,
        _priceFallbackApplied: usedOriginalFallback
    };
}

module.exports = {
    parsePriceValue,
    parseStockValue,
    parseActiveStatus,
    pickFirstPositivePrice,
    getFieldIgnoreCase,
    normalizeAndSanitizeSiagoldRecord
};
