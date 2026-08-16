const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const startStr = '// These endpoints will be added to server.ts';
const endStr = 'app.delete("/api/v1/tenants/:tenantId/vouchers/:id", checkTenantAccess, async (req, res) => {\n  try {\n    const tenantId = req.params.tenantId;\n    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", req.params.id).eq("tenant_id", tenantId);\n    if (error) throw error;\n    res.json({ success: true });\n  } catch (e: any) {\n    res.status(500).json({ error: e.message });\n  }\n});';

const startIdx = code.indexOf(startStr);
const endIdx = code.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    const fullEndIdx = endIdx + endStr.length;
    const injectedCode = code.substring(startIdx, fullEndIdx);
    
    // Remove it from current location
    code = code.substring(0, startIdx) + code.substring(fullEndIdx);
    
    // Add it at the end of the file, right before:
    const insertPoint = code.lastIndexOf('  if (process.env.NODE_ENV !== "production") {');
    if (insertPoint !== -1) {
        code = code.substring(0, insertPoint) + '\n' + injectedCode + '\n\n' + code.substring(insertPoint);
        fs.writeFileSync('server.ts', code);
        console.log("Successfully fixed server.ts location");
    } else {
        console.error("Could not find insert point");
    }
} else {
    console.error("Could not find start/end points", startIdx, endIdx);
}
