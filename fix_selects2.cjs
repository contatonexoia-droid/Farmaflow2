const fs = require('fs');

const fixSelects = (filePath) => {
  let code = fs.readFileSync(filePath, 'utf8');
  const badCols = [
    'image_url_2, ',
    'image_url_3, ',
    'video_uri, ',
    'promotion_type, ',
    'buy_x, ',
    'pay_y, ',
    'discount_qty_threshold, ',
    'discount_qty_percentage, ',
    'requires_prescription, ',
    'is_ai_enriched, '
  ];
  
  let newCode = code;
  for (const col of badCols) {
    newCode = newCode.split(col).join('');
  }
  
  fs.writeFileSync(filePath, newCode);
  console.log('Fixed', filePath);
};

fixSelects('server.ts');
fixSelects('services/storage.ts');
