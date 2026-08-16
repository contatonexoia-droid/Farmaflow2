import Papa from 'papaparse';

const text = "Código_interno,Ativo,Nome_ Produto,Un.,Ean_Barras,Preco_Venda\n34384,Ativo,ZIPLOC SACO P UN,UN,7790520802279,12.86";

let aoa;
Papa.parse(text, {
    header: false,
    skipEmptyLines: true,
    complete: (results) => {
        aoa = results.data;
    }
});

const keywords = ['nome', 'produto', 'descricao', 'ean', 'codigo', 'barras', 'preco', 'valor', 'estoque', 'quantidade', 'ativo', 'unidade', 'un'];
const normalize = (str) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

let bestHeaderIdx = 0;
let maxScore = -1;

for (let i = 0; i < Math.min(20, aoa.length); i++) {
    const row = aoa[i];
    if (!row || !Array.isArray(row)) continue;
    let score = 0;
    for (const cell of row) {
        if (!cell) continue;
        const norm = normalize(cell);
        for (const kw of keywords) {
            if (norm.includes(kw)) score++;
        }
    }
    if (score > maxScore) {
        maxScore = score;
        bestHeaderIdx = i;
    }
}

const headers = aoa[bestHeaderIdx] || [];
const result = [];
for (let i = bestHeaderIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    
    const isEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
    if (isEmpty) continue;
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header !== undefined && header !== null && String(header).trim() !== '') {
            obj[String(header)] = row[j];
        }
    }
    result.push(obj);
}

const json = result;

console.log("JSON parsed length:", json.length);

const getValFromRow = (row, keys) => {
    const norm = (str) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedKeys = keys.map(k => norm(k));
    
    for (const key of Object.keys(row)) {
        if (normalizedKeys.includes(norm(key))) {
            return row[key];
        }
    }
    return undefined;
};

const row = json[0];
const getVal = (keys) => getValFromRow(row, keys);

const name = getVal(['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']);
const code = getVal(['Codigo', 'CodigoInterno', 'Ref', 'CODIGO_INTERNO', 'codigo interno']);
const ean = getVal(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);

console.log("name:", name);
console.log("code:", code);
console.log("ean:", ean);
