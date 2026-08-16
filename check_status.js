import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin.from('agent_integrations').select('last_seen, tenant_id').eq('tenant_id', 'farmaciatrevo');
  console.log(data);
}
run();
