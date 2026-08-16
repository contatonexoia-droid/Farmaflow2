const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const keys = ['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto'];
const normalizedKeys = keys.map(k => normalize(k));

const key1 = "Nome_Produto";
const key2 = "Nome_ Produto ";
const key3 = "Ean_Barras";
console.log("normalizedKeys:", normalizedKeys);
console.log("key1 Match?", normalizedKeys.includes(normalize(key1)));
console.log("key2 Match?", normalizedKeys.includes(normalize(key2)));
console.log("Ean_Barras:", normalize(key3));
