const express = require('express');
const app = express();
const path = require('path');
const distPath = path.join(process.cwd(), "dist");

app.use("/sw.js", (req, res, next) => {
  res.setHeader("Service-Worker-Allowed", "/");
  next();
});

app.use(express.static(distPath, {
  maxAge: '1d',
  setHeaders: (res, filepath) => {
    if (
      filepath.endsWith('.html') || 
      filepath.endsWith('sw.js') || 
      filepath.endsWith('manifest.json')
    ) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const server = app.listen(3005, () => {
  console.log("Test server running on 3005");
});
