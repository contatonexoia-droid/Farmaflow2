const fs = require('fs');
const code = fs.readFileSync('services/storage.ts', 'utf8');
const lines = code.split('\n');
let start = 0;
for(let i=0; i<lines.length; i++) {
    if(lines[i].includes('export const saveProductsByTenant')) {
        start = i;
        break;
    }
}
console.log(lines.slice(start, start + 50).join('\n'));
