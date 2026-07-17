const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const keys = ['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto'];
const normalizedKeys = keys.map(k => normalize(k));

const key = "Nome_Produto";
console.log("normalizedKeys:", normalizedKeys);
console.log("normalize(key):", normalize(key));
console.log("Match?", normalizedKeys.includes(normalize(key)));
