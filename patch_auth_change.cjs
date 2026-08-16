const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const targetStr = `} else if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && s) {`;
const newStr = `} else if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") && s) {`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('App.tsx', code);
