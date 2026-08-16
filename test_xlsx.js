import * as XLSX from 'xlsx';

// Create dummy workbook
const ws = XLSX.utils.aoa_to_sheet([
  ["Relatorio Gerencial"],
  [],
  ["Código_interno", "Ativo", "Nome_ Produto", "Un.", "Ean_Barras", "Preco_Venda"],
  [34384, "Ativo", "ZIPLOC SACO P UN", "UN", 7790520802279, 12.86]
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

const rawJson = XLSX.utils.sheet_to_json(ws);
console.log("Default json:", rawJson);

const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log("AOA:", aoa);
