const fs = require('fs');
let code = fs.readFileSync('components/AdminProductManager.tsx', 'utf8');

const targetStock = `const rowStock = parseNumberSafe(getVal(['Estoque', 'Qtd', 'Quantidade', 'ESTOQUE_ATUAL', 'estoque']));`;
const replaceStock = `let rowStock = parseNumberSafe(getVal(['Estoque', 'Qtd', 'Quantidade', 'ESTOQUE_ATUAL', 'estoque']));
            if (rowStock < 0) {
                rowStock = Math.abs(rowStock);
            }`;

const targetNewCode = `const newCode = code ? String(code) : (p.internalCode ? String(p.internalCode).trim() : undefined);`;
const replaceNewCode = `const newCode = code !== undefined ? String(code) : (p.internalCode ? String(p.internalCode).trim() : undefined);`;

if (!code.includes(targetStock)) {
    console.error("targetStock not found");
    process.exit(1);
}
if (!code.includes(targetNewCode)) {
    console.error("targetNewCode not found");
    process.exit(1);
}

code = code.replace(targetStock, replaceStock);
code = code.replace(targetNewCode, replaceNewCode);

fs.writeFileSync('components/AdminProductManager.tsx', code);
console.log("Replacements successful!");
