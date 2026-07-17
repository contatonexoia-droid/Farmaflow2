import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  const { data, error } = await supabaseAdmin.from('agent_integrations').select('*, tenants(id, name, erp_url, erpurl)').limit(1);
  console.log(error || Object.keys(data?.[0]?.tenants || {}));
}
check();
