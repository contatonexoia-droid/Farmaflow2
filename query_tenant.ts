import { createClient } from '@supabase/supabase-js';
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
async function run() {
  const { data } = await supabaseAdmin.from('products').select('tenant_id, tenantid').limit(5);
  console.log("Tenant IDs:", data);
}
run();
