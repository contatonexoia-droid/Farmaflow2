const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(
  `          if (!tenant.erp_url) {\n            // URL sanitization logic moved below\n          }`,
  `          if (!tenant.erp_url) continue;`
);
fs.writeFileSync('server.ts', code);
