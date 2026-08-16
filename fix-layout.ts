import fs from "fs";
import path from "path";

// 1. App.tsx formatting
let app = fs.readFileSync("App.tsx", "utf8");
app = app.replace(/font-bold text-sm mb-2/g, "font-bold text-[15px] mb-2");
app = app.replace(/font-bold text-sm text-gray-500/g, "font-bold text-[15px] text-gray-500");
app = app.replace(/text-sm hover:bg-red-50/g, "text-[15px] hover:bg-red-50");
fs.writeFileSync("App.tsx", app);

// 2. Component width fixes
const componentsDir = path.join(process.cwd(), "components");
const files = fs.readdirSync(componentsDir).filter(f => f.startsWith("Admin") && f.endsWith(".tsx"));

for (const file of files) {
  const filePath = path.join(componentsDir, file);
  let content = fs.readFileSync(filePath, "utf8");
  
  // We want to unconstrain the main wrapper of panels
  // e.g., <div className="p-4 md:p-8 max-w-6xl mx-auto
  // Notice that sometimes it's `<div className="max-w-4xl space-y-8`
  
  content = content.replace(/max-w-4xl /g, "");
  content = content.replace(/max-w-5xl /g, "");
  content = content.replace(/max-w-6xl /g, "");
  
  // Also if it happens to be at the end of the class string
  content = content.replace(/ max-w-4xl"/g, '"');
  content = content.replace(/ max-w-5xl"/g, '"');
  content = content.replace(/ max-w-6xl"/g, '"');

  // Specific exceptions might apply, but generally removing max-w from Admin* roots
  fs.writeFileSync(filePath, content);
}
console.log("Layout sizing updated successfully.");
