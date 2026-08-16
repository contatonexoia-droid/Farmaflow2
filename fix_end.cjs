const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const searchStr = `    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
        }
        if (filepath.endsWith('sw.js')) {
          res.setHeader('Service-Worker-Allowed', '/');
      res.sendFile(path.join(distPath, "index.html"));
    });`;

const replaceStr = `    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('server.ts', code);
  console.log("Fixed end of file syntax.");
} else {
  console.log("Could not find the exact string.");
}
