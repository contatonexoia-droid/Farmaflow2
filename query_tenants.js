import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data: tenants, error } = await supabaseAdmin.from('tenants')
    .select('id, slug, custom_domain, network_id');
  if (error) {
    console.error("ERROR:", error);
  } else {
    console.log("Tenants found:", JSON.stringify(tenants, null, 2));
  }
}
run();
