const fs = require('fs');
let code = fs.readFileSync('components/Cart.tsx', 'utf8');

code = code.replace(
  'cep: cCep || "",',
  'cep: cCep || "Não informado",'
);

fs.writeFileSync('components/Cart.tsx', code);
