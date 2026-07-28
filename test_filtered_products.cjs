const SYNONYM_MAP = {
      shampoo: ["shampoo", "sh", "xampu", "champu"],
      sh: ["shampoo", "sh", "xampu", "champu"],
      xampu: ["shampoo", "sh", "xampu", "champu"],
};
const STOP_WORDS = new Set(["de", "para", "com"]);
const singularize = (word) => word;

const products = [
  { id: 1, name: "SH NIELY GOLD NUTR MAGICA 275ML", stock: 3, category: "SHAMPOO ADULTO", activePrinciple: "" },
  { id: 2, name: "KIT S/LINE SH+CR 4EM1 DEF NAT 300ML", stock: 0, category: "CABELOS", activePrinciple: "" },
  { id: 3, name: "ESM BEAUTY ME CREMO BLUSH 11ML", stock: 4, category: "ESMALTE", activePrinciple: "" },
  { id: 4, name: "FRA PAMPERS SPLASHERS P-M 12UN", stock: 6, category: "FRALDA", activePrinciple: "" }
];

function normalizeStr(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function testSearch(debouncedSearchTerm) {
  let term = normalizeStr(debouncedSearchTerm);
  let searchTokens_raw = term.split(" ").filter((t) => t.length > 0);
  let searchTokens = searchTokens_raw.filter((t, i, arr) => {
    if (!STOP_WORDS.has(t)) return true;
    if (t.length === 1 && arr.length > 1) return true;
    return false;
  }).map(singularize);

  let expandedTokens = [...searchTokens];
  searchTokens.forEach((t) => {
    Object.entries(SYNONYM_MAP).forEach(([key, syns]) => {
      if (t.includes(key) || syns.some((s) => t.includes(s))) {
        expandedTokens.push(key);
        expandedTokens = [...expandedTokens, ...syns];
      }
    });
  });
  expandedTokens = Array.from(new Set(expandedTokens));

  const baseList = products.map(p => {
    if (p.stock <= 0 && !debouncedSearchTerm.trim()) return null;

    const pName = normalizeStr(p.name);
    const pCat = normalizeStr(p.category);
    const pActive = normalizeStr(p.activePrinciple);
    const pManuf = "";
    const pInd = "";
    const pType = "";
    
    let matchScore = 0;
    
    if (searchTokens.length > 0) {
      let hasExactTokenMatch = false;
      let hasExpandedMatch = false;
      let manufacturerMatched = false;
      let categoryMatched = false;
      let tokensMatchedCount = 0;
      
      searchTokens.forEach((token) => {
        let matchedManuf = false;
        let matchedCat = false;
        let nameMatched = false;
        let otherMatched = false;

        if (token.length === 1) {
          const regex = new RegExp(`(?:^|\\s|-)${token}(?:\\s|-|$)`, "i");
          nameMatched = regex.test(pName) || regex.test(pActive);
        } else {
          matchedManuf = false;
          matchedCat = pCat.includes(token) || (SYNONYM_MAP[token] && SYNONYM_MAP[token].some(syn => pCat.includes(syn)));
          nameMatched = pName.includes(token) || pActive.includes(token) || (SYNONYM_MAP[token] && SYNONYM_MAP[token].some(syn => pName.includes(syn) || pActive.includes(syn)));
          otherMatched = false;
        }

        if (matchedManuf) manufacturerMatched = true;
        if (matchedCat) categoryMatched = true;

        if (nameMatched || matchedManuf || matchedCat || otherMatched) {
          hasExactTokenMatch = true;
          tokensMatchedCount++;
        }
      });
      
      const matchedAllOriginalTokens = tokensMatchedCount === searchTokens.length;
      if (!matchedAllOriginalTokens) return null;
      
      matchScore += 100;
    }
    
    return { ...p, _searchScore: matchScore, _priority: 1 };
  }).filter(Boolean);

  console.log(`Results for "${debouncedSearchTerm}":`, baseList.map(p => p.name));
}

testSearch("shampoo");
testSearch("sh");
testSearch("xampu");
