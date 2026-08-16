const getValFromRow = (row, keys) => {
    const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedKeys = keys.map(k => normalize(k));
    
    for (const key of Object.keys(row)) {
        if (normalizedKeys.includes(normalize(key))) {
            return row[key];
        }
    }
    return undefined;
};

const row = {
    "Código_interno": 34384,
    "Ativo": "Ativo",
    "Nome_ Produto": "ZIPLOC SACO P UN",
    "Un.": "UN",
    "Ean_Barras": 7790520802279,
    "Preco_Venda": 12.86
};

const name = getValFromRow(row, ['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']);
const code = getValFromRow(row, ['Codigo', 'CodigoInterno', 'Ref', 'CODIGO_INTERNO', 'codigo interno']);
const ean = getValFromRow(row, ['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);

console.log("name:", name);
console.log("code:", code);
console.log("ean:", ean);
