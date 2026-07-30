const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const oldLoop = `            if (nexoProduct && nexoProduct.stock !== erpItem.stock) {
              await supabase
                .from("products")
                .update({ stock: erpItem.stock })
                .eq("id", nexoProduct.id);
              updatedCount++;
            }`;

const newLoop = `            if (nexoProduct && nexoProduct.stock !== erpItem.stock) {
              try {
                await supabase
                  .from("products")
                  .update({ stock: erpItem.stock })
                  .eq("id", nexoProduct.id);
                updatedCount++;
              } catch (e: any) {
                console.error(\`[Cron] Failed to update product \${nexoProduct.id}:\`, e.message);
              }
            }`;

code = code.replace(oldLoop, newLoop);
fs.writeFileSync('server.ts', code);
