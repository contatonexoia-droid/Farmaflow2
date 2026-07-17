import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Fetching tenants...");
  const { data: tenants, error: tenantsError } = await supabase
    .from("tenants")
    .select("id, name, full_address, delivery_settings");
  
  if (tenantsError) {
    console.error("Error fetching tenants:", tenantsError);
  } else {
    console.log("Tenants found:", tenants.length);
    tenants.forEach(t => {
      console.log(`\nTenant ID: ${t.id}`);
      console.log(`Name: ${t.name}`);
      console.log(`Address: ${t.full_address}`);
      console.log(`Delivery Settings:`, JSON.stringify(t.delivery_settings, null, 2));
    });
  }

  console.log("\nFetching delivery_fees...");
  const { data: fees, error: feesError } = await supabase
    .from("delivery_fees")
    .select("*");
  
  if (feesError) {
    console.error("Error fetching delivery_fees:", feesError);
  } else {
    console.log("Delivery Fees found:", fees.length);
    fees.forEach(f => {
      console.log(`- Tenant: ${f.tenant_id}, Min KM: ${f.min_km}, Max KM: ${f.max_km}, Fee: R$ ${f.fee}`);
    });
  }

  console.log("\nFetching recent cached distances...");
  const { data: cached, error: cachedError } = await supabase
    .from("delivery_distance_cache")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (cachedError) {
    console.error("Error fetching delivery_distance_cache:", cachedError);
  } else {
    console.log("Distance Cache entries:", cached.length);
    cached.forEach(c => {
      console.log(`- Origin: ${c.origin_address}\n  Dest: ${c.destination_address}\n  Distance: ${c.distance_km} km\n  Created: ${c.created_at}`);
    });
  }
}

run();
