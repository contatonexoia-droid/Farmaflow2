const fs = require('fs');

const fixUpsert = (filePath) => {
  let code = fs.readFileSync(filePath, 'utf8');
  
  const badLines = [
    'is_ai_enriched:',
    'promotion_type:',
    'original_price:',
    'buy_x:',
    'pay_y:',
    'discount_qty_threshold:',
    'discount_qty_percentage:',
    'video_uri:',
    'requires_prescription:'
  ];
  
  let lines = code.split('\n');
  let newLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let isBad = false;
    for (const bad of badLines) {
      if (line.includes(bad)) {
        isBad = true;
        break;
      }
    }
    if (!isBad) {
      newLines.push(line);
    } else {
      console.log('Removed:', line);
    }
  }
  
  fs.writeFileSync(filePath, newLines.join('\n'));
  console.log('Fixed', filePath);
};

fixUpsert('services/storage.ts');
