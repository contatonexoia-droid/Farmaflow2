import { createClient } from '@supabase/supabase-js';
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
async function run() {
  const res = await supabaseAdmin.rpc('get_policies', {}).catch(()=>null);
  console.log("RPC get_policies:", res);
  // since we don't have postgres access directly, we might just try to insert without requires_prescription and see if it works.
}
run();
