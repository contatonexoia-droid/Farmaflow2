import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function resolveTenant(hostname) {
  const parts = hostname.split(".");
  const tenantSlug = parts[0];
  
  let tenantData = null;
  let { data, error } = await supabase
    .from("tenants")
    .select("*")
    .or(`slug.eq.${tenantSlug},id.eq.${tenantSlug}`)
    .maybeSingle();
      
  if (!error && data) {
    tenantData = data;
  } else {
    // Fallback
    const { data: allTenants, error: allErr } = await supabase
      .from("tenants")
      .select("*");
    if (!allErr && allTenants) {
      const matched = allTenants.find(t => {
        const cleanSlug = (t.slug || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const cleanId = (t.id || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const searchClean = tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, "");
        return cleanSlug === searchClean || cleanId === searchClean;
      });
      if (matched) {
        tenantData = matched;
      }
    }
  }
  return tenantData;
}

async function run() {
  const t1 = await resolveTenant("farmaciatrevo.farmaflow.online");
  const t2 = await resolveTenant("farmacia-trevo.farmaflow.online");
  console.log("For farmaciatrevo.farmaflow.online resolved:", t1 ? { id: t1.id, name: t1.name, network_id: t1.network_id } : null);
  console.log("For farmacia-trevo.farmaflow.online resolved:", t2 ? { id: t2.id, name: t2.name, network_id: t2.network_id } : null);
}
run();
