const fs = require('fs');
let code = fs.readFileSync('services/storage.ts', 'utf8');

const targetStr = 'const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/products?t=${Date.now()}`, {';
const newStr = 'const response = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/products`, {';

code = code.replace(targetStr, newStr);
fs.writeFileSync('services/storage.ts', code);
