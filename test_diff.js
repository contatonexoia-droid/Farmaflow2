import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function run() {
  // 1. Get from endpoint simulation (maybeSingle)
  let { data: endpointTenant } = await supabase
    .from("tenants")
    .select("*")
    .or(`slug.eq.farmaciatrevo,id.eq.farmaciatrevo`)
    .maybeSingle();

  // 2. Get from getTenants simulation (select * from tenants)
  let { data: allTenants } = await supabase
    .from("tenants")
    .select("*");
  const directTenant = allTenants.find(t => t.id === 'farmaciatrevo');

  console.log("Endpoint keys count:", Object.keys(endpointTenant).length);
  console.log("Direct keys count:", Object.keys(directTenant).length);

  // Compare properties
  const diffs = {};
  for (const key of Object.keys(directTenant)) {
    if (JSON.stringify(directTenant[key]) !== JSON.stringify(endpointTenant[key])) {
      diffs[key] = {
        direct: directTenant[key],
        endpoint: endpointTenant[key]
      };
    }
  }
  console.log("Differences:", JSON.stringify(diffs, null, 2));
}
run();
