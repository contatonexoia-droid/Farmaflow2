const fs = require('fs');
let code = fs.readFileSync('components/AdminProductManager.tsx', 'utf8');

// Strip out references to those non-existent properties from productToSave payload
const badProps = [
  'originalPrice: Number(editingProduct.originalPrice) || 0,',
  'buyX: Number(editingProduct.buyX) || 0,',
  'payY: Number(editingProduct.payY) || 0,'
];

for (const prop of badProps) {
  code = code.replace(prop, '');
}

fs.writeFileSync('components/AdminProductManager.tsx', code);
console.log('Fixed AdminProductManager.tsx');
