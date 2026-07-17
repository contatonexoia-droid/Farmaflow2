const fs = require('fs');

let code = fs.readFileSync('components/AdminAnalytics.tsx', 'utf8');

const regex = /<Line[^>]+dataKey="views_count"[^>]*\/>/g;
const replacement = `<Line 
                        type="monotone" 
                        dataKey="views_count" 
                        name="Acessos Totais"
                        stroke="#3B82F6" 
                        strokeWidth={4}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="pwa_installs_count" 
                        name="Instalações"
                        stroke="#10B981" 
                        strokeWidth={4}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />`;

code = code.replace(regex, replacement);

fs.writeFileSync('components/AdminAnalytics.tsx', code);
