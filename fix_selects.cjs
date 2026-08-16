const fs = require('fs');

const fixSelects = (filePath) => {
  let code = fs.readFileSync(filePath, 'utf8');
  // Remove invalid column names from select string
  const badCols = [
    'tenantid, ',
    'internalcode, ',
    'activeprinciple, ',
    'drugtype, ',
    'groupingslug, ',
    'variantattribute, ',
    'videouri, '
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

