import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`    if ((parsed.type === "SUPER_ADMIN" || parsed.type === "ADMIN") && (!parsed.access_token || !parsed.refresh_token)) {`,
`    if ((parsed.type === "SUPER_ADMIN" || parsed.type === "PHARMACY_ADMIN") && (!parsed.access_token || !parsed.refresh_token)) {`
);
fs.writeFileSync('App.tsx', content);
