const fs = require('fs');
const path = require('path');
const {
    parsePriceValue,
    parseStockValue,
    extractBarcode,
    extractInternalCode,
    getFieldIgnoreCase
} = require('./priceNormalizer');

const STATE_FILE = path.join(process.cwd(), 'farmaflow_config.json');
const SYNC_CACHE_FILE = path.join(process.cwd(), 'farmaflow_sync_cache.json');

function loadConfig() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (err) {
            console.error('⚠️ Aviso: Falha ao ler farmaflow_config.json:', err.message);
        }
    }
    return null;
}

function saveConfig(config) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(config, null, 2));
}

function getLastSyncDate() {
    const config = loadConfig();
    return (config && config.lastSyncDate) ? config.lastSyncDate : '1970-01-01T00:00:00.000Z';
}

function updateLastSyncDate(dateStr) {
    const config = loadConfig() || {};
    config.lastSyncDate = dateStr;
    saveConfig(config);
}

/**
 * Carrega o cache local de assinaturas (hashes) de produtos sincronizados.
 * Estrutura: { lastFullSyncAt: number, items: Record<string, string> }
 */
function loadSyncCache() {
    if (fs.existsSync(SYNC_CACHE_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(SYNC_CACHE_FILE, 'utf8'));
            if (raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object') {
                return {
                    lastFullSyncAt: Number(raw.lastFullSyncAt) || 0,
                    items: raw.items
                };
            }
        } catch (err) {
            console.warn('⚠️ Aviso: Cache local farmaflow_sync_cache.json inválido ou corrompido, recriando...');
        }
    }
    return {
        lastFullSyncAt: 0,
        items: {}
    };
}

/**
 * Salva o mapa de assinaturas de produtos no arquivo farmaflow_sync_cache.json
 */
function saveSyncCache(cacheData) {
    try {
        const payload = {
            lastFullSyncAt: Number(cacheData?.lastFullSyncAt) || 0,
            updatedAt: new Date().toISOString(),
            items: cacheData?.items || {}
        };
        fs.writeFileSync(SYNC_CACHE_FILE, JSON.stringify(payload, null, 2));
    } catch (err) {
        console.warn('⚠️ Aviso: Não foi possível salvar farmaflow_sync_cache.json:', err.message);
    }
}

/**
 * Extrai a chave única do produto (priorizando código interno e fallback para EAN/barcode)
 */
function extractProductKey(record) {
    if (!record || typeof record !== 'object') return null;
    const directInternal = record.internal_code || record.codigo_interno || record.codigo;
    const directBarcode = record.barcode || record.ean || record.codigo_barras;

    if (directInternal && String(directInternal).trim()) {
        return String(directInternal).trim();
    }
    if (directBarcode && String(directBarcode).trim()) {
        return String(directBarcode).trim();
    }

    const bc = extractBarcode(record);
    const code = extractInternalCode(record, bc);
    return code || bc || null;
}

/**
 * Constrói a assinatura determinística dos dados reais do produto:
 * `${estoque}|${preco}|${preco_promocional}|${nome}`
 */
function buildProductSignature(record) {
    if (!record || typeof record !== 'object') return '';

    const rawStock =
        record.stock ??
        record.estoque ??
        getFieldIgnoreCase(record, [
            'estoque', 'Estoque_Atual', 'estoque_atual', 'Qtd_Estoque', 'qtd_estoque',
            'saldo', 'Saldo_Estoque', 'quantidade', 'stock'
        ]);
    const estoque = record.active === false ? 0 : parseStockValue(rawStock);

    const rawPrice =
        record.price ??
        record.preco_venda ??
        record.preco ??
        getFieldIgnoreCase(record, [
            'preco_venda', 'Preco_Venda', 'vl_venda', 'Vl_Venda', 'valor_venda',
            'preco', 'Preco', 'price'
        ]);
    const preco = parsePriceValue(rawPrice).toFixed(2);

    const rawPromo =
        record.promotional_price ??
        record.preco_promocional ??
        getFieldIgnoreCase(record, [
            'preco_promocional', 'Preco_Promocional', 'vl_promocao', 'Vl_Promocao',
            'preco_oferta', 'Preco_Oferta', 'promotional_price'
        ]);
    const promoVal = parsePriceValue(rawPromo);
    const precoPromocional = promoVal > 0 ? promoVal.toFixed(2) : '0.00';

    const rawName =
        record.name ??
        record.nome ??
        record.descricao ??
        record.Descricao ??
        getFieldIgnoreCase(record, [
            'nome', 'Nome', 'descricao', 'Descricao', 'DESCRICAO',
            'produto', 'Produto', 'ds_produto', 'Ds_Produto', 'name'
        ]) ??
        '';
    const nome = String(rawName).trim().replace(/\s+/g, ' ').toUpperCase();

    return `${estoque}|${preco}|${precoPromocional}|${nome}`;
}

module.exports = {
    loadConfig,
    saveConfig,
    getLastSyncDate,
    updateLastSyncDate,
    loadSyncCache,
    saveSyncCache,
    extractProductKey,
    buildProductSignature
};
