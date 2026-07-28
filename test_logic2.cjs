const SYNONYM_MAP = {
  sh: ["shampoo", "sh", "xampu", "champu"],
  dor: ["dor", "dorflex"]
};

function check(token, pName) {
  const checkSyn = (syn, target) => {
    if (syn.length <= 3) {
      return new RegExp(`(?:^|\\s|-|\\+|\\/)${syn}(?:\\s|-|\\+|\\/|$)`, "i").test(target);
    }
    return target.includes(syn);
  };

  const nameMatched = 
    checkSyn(token, pName) ||
    (SYNONYM_MAP[token] && SYNONYM_MAP[token].some(syn => checkSyn(syn, pName)));

  return nameMatched;
}

console.log("sh -> sh niely gold:", check("sh", "sh niely gold")); // true
console.log("sh -> shampoo adulto:", check("sh", "shampoo adulto")); // true
console.log("sh -> fresh:", check("sh", "fresh")); // false

console.log("sha -> shampoo adulto:", check("sha", "shampoo adulto")); // false, wait!
