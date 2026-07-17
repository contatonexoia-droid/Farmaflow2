const tokens = ["vitamina", "c"];
const safePattern = tokens.map(t => t.length === 1 ? `\\b${t}\\b` : t).join("|");
const regex = new RegExp(`(${safePattern})`, "gi");
const text = "Vitamina C 1g Cimed";
const parts = text.split(regex);
console.log(parts);
console.log(parts.map(part => tokens.some(t => part.toLowerCase() === t.toLowerCase()) ? `[${part}]` : part).join(""));
