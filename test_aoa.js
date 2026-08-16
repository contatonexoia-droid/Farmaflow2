import * as XLSX from 'xlsx';

const aoa = [
  [ 'Relatorio Gerencial' ],
  [],
  [ 'Código_interno', 'Ativo', 'Nome_ Produto', 'Un.', 'Ean_Barras', 'Preco_Venda' ],
  [ 34384, 'Ativo', 'ZIPLOC SACO P UN', 'UN', 7790520802279, 12.86 ]
];

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
    
    // Check if row is completely empty
    const isEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
    if (isEmpty) continue;
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header) {
            obj[header] = row[j];
        }
    }
    result.push(obj);
}

console.log("Headers row:", bestHeaderIdx);
console.log("Result:", result);
