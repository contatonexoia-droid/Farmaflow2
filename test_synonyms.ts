const PHARMA_SYNONYMS: Record<string, string[]> = {
  gotas: ['gotas', 'gts'],
  gts: ['gotas', 'gts'],
  comprimido: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps'],
  comprimidos: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps'],
  cpr: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps'],
  cp: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps'],
  cps: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps'],
  xarope: ['xarope', 'xpe'],
  xpe: ['xarope', 'xpe'],
  pomada: ['pomada', 'pmd'],
  pmd: ['pomada', 'pmd'],
  injetavel: ['injetavel', 'inj'],
  inj: ['injetavel', 'inj'],
  solucao: ['solucao', 'sol'],
  sol: ['solucao', 'sol'],
  suspenso: ['suspenso', 'suspensao', 'susp'],
  suspensao: ['suspenso', 'suspensao', 'susp'],
  susp: ['suspenso', 'suspensao', 'susp'],
  creme: ['creme', 'crm'],
  crm: ['creme', 'crm']
};

const palavras = ["clonazepam", "gotas"];

let ilikePatterns: string[] = [""];
palavras.forEach((p) => {
    const norm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const syns = PHARMA_SYNONYMS[norm] || [p];
    const newPatterns: string[] = [];
    ilikePatterns.forEach(pattern => {
        syns.forEach(syn => {
            newPatterns.push(pattern + (pattern ? "%" : "") + syn);
        });
    });
    ilikePatterns = newPatterns;
});
const orClauses = ilikePatterns.map(pattern => {
    const finalPattern = `%${pattern}%`;
    return `name.ilike.${finalPattern},description.ilike.${finalPattern}`;
}).join(",");

console.log("ILIKE:", orClauses);

const tsQueryFormated = palavras.map(p => {
    const norm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const syns = PHARMA_SYNONYMS[norm] || [p];
    if (syns.length > 1) {
       return `(${syns.map(s => `${s}:*`).join(" | ")})`;
    }
    return `${p}:*`;
}).join(" & ");

console.log("FTS:", tsQueryFormated);
