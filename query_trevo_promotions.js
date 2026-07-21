import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabaseAdmin.from('promotions')
    .select('*')
    .or('tenant_id.eq.farmaciatrevo,tenant_id.eq.farmacia-trevo,tenant_id.eq.drogaria-trevo');
  if (error) {
    console.error("ERROR:", error);
  } else {
    data.forEach(p => {
      console.log(`ID: ${p.id}, TenantID: ${p.tenant_id}, Name: ${p.name}, Type: ${p.type}, Scope: ${p.scope}, TargetType: ${p.target_type}`);
      console.log(`SpecificProductIds: ${JSON.stringify(p.specific_product_ids)}`);
      console.log(`BundleSlots: ${JSON.stringify(p.bundle_slots)}`);
    });
  }
}
run();
