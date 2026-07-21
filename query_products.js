import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data: prods, error } = await supabaseAdmin.from('products')
    .select('id, name, barcode, tenant_id')
    .eq('tenant_id', 'farmaciatrevo');
  if (error) {
    console.error("ERROR:", error);
  } else {
    console.log("Products of farmacia-trevo:", JSON.stringify(prods, null, 2));
  }
}
run();
