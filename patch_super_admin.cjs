const fs = require('fs');
const file = 'components/SuperAdminManager.tsx';
let content = fs.readFileSync(file, 'utf8');

// Add import
content = content.replace(
  "import * as XLSX from 'xlsx';",
  "import * as XLSX from 'xlsx';\nimport { ActivationTokenManager } from './ActivationTokenManager';"
);

// Add component
content = content.replace(
  '<div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">',
  '<ActivationTokenManager />\n      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">'
);

fs.writeFileSync(file, content);
