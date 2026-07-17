const fs = require('fs');

let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  'app.get("/api/v1/manifest/:tenantId", async (req, res) => {',
  'app.get(["/api/v1/manifest/:tenantId", "/manifest.json"], async (req, res) => {'
);

fs.writeFileSync('server.ts', code);
