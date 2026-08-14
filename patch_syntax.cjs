const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Find the bad block
const searchStr = `app.use("/sw.js", (req, res, next) => {
  res.setHeader("Service-Worker-Allowed", "/");
  next();
    res.status(404).send("Service worker file not found");
  }
});`;

const replaceStr = `app.use("/sw.js", (req, res, next) => {
  res.setHeader("Service-Worker-Allowed", "/");
  next();
});`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('server.ts', code);
  console.log('Fixed syntax error!');
} else {
  console.log('Search string not found. Please review the file manually.');
}
