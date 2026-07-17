const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  '.select("views_count")',
  '.select("views_count, pwa_installs_count")'
);

code = code.replace(
  'const totalMonthViews = monthStats ? monthStats.reduce((acc, curr) => acc + curr.views_count, 0) : 0;',
  `const totalMonthViews = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.views_count || 0), 0) : 0;
    const totalMonthInstalls = monthStats ? monthStats.reduce((acc, curr) => acc + (curr.pwa_installs_count || 0), 0) : 0;`
);

code = code.replace(
  'totals: {\n          views: totalMonthViews\n        }',
  'totals: {\n          views: totalMonthViews,\n          installs: totalMonthInstalls\n        }'
);

fs.writeFileSync('server.ts', code);
