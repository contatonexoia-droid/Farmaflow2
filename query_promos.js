import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data: promos, error } = await supabaseAdmin.from('promotions')
    .select('*')
    .eq('tenant_id', 'farmaciatrevo');
  if (error) {
    console.error("ERROR:", error);
  } else {
    console.log("Promotions found:", JSON.stringify(promos, null, 2));
  }
}
run();
