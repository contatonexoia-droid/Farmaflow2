const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(
  '// Serve sw.js with Service-Worker-Allowed header to allow registration from scoped subpaths\n',
  '// Ensure Service-Worker-Allowed header is set for all /sw.js requests\napp.use("/sw.js", (req, res, next) => {\n  res.setHeader("Service-Worker-Allowed", "/");\n  next();\n});\n\n'
);
fs.writeFileSync('server.ts', code);
