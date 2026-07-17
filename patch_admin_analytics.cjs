const fs = require('fs');

let code = fs.readFileSync('components/AdminAnalytics.tsx', 'utf8');

// 1. Initial State
code = code.replace(
  'totals: { views: 0 },',
  'totals: { views: 0, installs: 0 },'
);

// 2. Compute total installs
code = code.replace(
  'const totalViews = (recentStats || []).reduce((acc: number, curr: any) => acc + curr.views_count, 0);',
  `const totalViews = (recentStats || []).reduce((acc: number, curr: any) => acc + curr.views_count, 0);
        const totalInstalls = (recentStats || []).reduce((acc: number, curr: any) => acc + (curr.pwa_installs_count || 0), 0);`
);

// 3. Set Stats
code = code.replace(
  'totals: { views: totalViews },',
  'totals: { views: totalViews, installs: totalInstalls },'
);

// 4. Export CSV
code = code.replace(
  'Total de Visualizações,${stats.totals.views}\\n\\n',
  'Total de Visualizações,${stats.totals.views}\\nTotal de Instalações,${stats.totals.installs}\\n\\n'
);

code = code.replace(
  'e.views_count}`).join',
  'e.views_count},${e.pwa_installs_count || 0}`).join'
);

code = code.replace(
  '"Data,Visualizações\\n"',
  '"Data,Visualizações,Instalações\\n"'
);

// 5. Add KPI Card
const kpiCardRegex = /<div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">[\s\S]*?<\/div>[\s\S]*?<\/div>/;

const kpiCardTemplate = `
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total de Instalações</p>
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">{stats.totals.installs}</h2>
                <div className="flex items-center gap-1 mt-2 text-emerald-600 font-bold text-xs">
                    <ArrowUpRight size={14} /> <span>No período selecionado</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center relative z-10">
                <Smartphone className="w-8 h-8 text-emerald-500" />
              </div>
            </div>
`;

code = code.replace(
  '          {/* KPI Cards */}\n          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">',
  '          {/* KPI Cards */}\n          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">\n' + kpiCardTemplate
);

// 6. Update chart to show installs
code = code.replace(
  '<Line type="monotone" dataKey="views_count" name="Visualizações" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />',
  `<Line type="monotone" dataKey="views_count" name="Visualizações" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="pwa_installs_count" name="Instalações" stroke="#10B981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />`
);

fs.writeFileSync('components/AdminAnalytics.tsx', code);
