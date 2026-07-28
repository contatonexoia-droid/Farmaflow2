const SYNONYM_MAP = {
  shampoo: ["shampoo", "sh", "xampu", "champu"],
  sh: ["shampoo", "sh", "xampu", "champu"],
  xampu: ["shampoo", "sh", "xampu", "champu"],
};

const pName = "sh niely gold nutr magica 275ml";
const pCat = "shampoo adulto";
const token = "shampoo";

const matchedCat =
  pCat.includes(token) ||
  (SYNONYM_MAP[token] && SYNONYM_MAP[token].some((syn) => pCat.includes(syn)));

const nameMatched = 
  pName.includes(token) || 
  (SYNONYM_MAP[token] && SYNONYM_MAP[token].some((syn) => pName.includes(syn)));

console.log({ matchedCat, nameMatched });
