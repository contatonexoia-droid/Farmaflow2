const fs = require('fs');
let code = fs.readFileSync('services/storage.ts', 'utf8');

const targetStr = `        let query = supabase
          .from("products")
          .select("*")
          .eq("tenant_id", tenantId)
          .range(from, from + step - 1);`;
const newStr = `        let query = supabase
          .from("products")
          .select("id, tenant_id, tenantid, internal_code, internalcode, barcode, name, active_principle, activeprinciple, drug_type, drugtype, manufacturer, presentation, price, original_price, stock, category, grouping_slug, groupingslug, variant_attribute, variantattribute, image, image_url_2, image_url_3, video_uri, videouri, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, requires_prescription, is_ai_enriched, is_featured")
          .eq("tenant_id", tenantId)
          .range(from, from + step - 1);`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('services/storage.ts', code);
