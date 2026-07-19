import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`      } else if (event === "TOKEN_REFRESHED" && s) {`,
`      } else if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && s) {`
);
fs.writeFileSync('App.tsx', content);
