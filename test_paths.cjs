const fs = require('fs');
const path = require('path');

let swPath = "";
const cwd = process.cwd();
const paths = [
  path.join(cwd, "public", "sw.js"),
  path.join(cwd, "dist", "sw.js"),
];
paths.push(path.join(__dirname, "public", "sw.js"));
paths.push(path.join(__dirname, "dist", "sw.js"));
paths.push(path.join(__dirname, "sw.js"));
paths.push(path.join(__dirname, "..", "public", "sw.js"));
paths.push(path.join(__dirname, "..", "dist", "sw.js"));

for (const p of paths) {
  if (fs.existsSync(p)) {
    console.log("Found:", p);
  } else {
    console.log("Not found:", p);
  }
}
