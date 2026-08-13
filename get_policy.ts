import { createClient } from '@supabase/supabase-js';
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
async function run() {
  const { data, error } = await supabaseAdmin.from('products').select('*').limit(1);
  // Actually, we can just do a REST query to pg_policies if it's exposed, which it usually isn't.
  // But maybe we can run a raw SQL query via rpc?
  const rpc = await supabaseAdmin.rpc('exec_sql', { sql: 'SELECT * FROM pg_policies WHERE tablename = \'products\'' });
  console.log("RPC:", rpc);
}
run();
