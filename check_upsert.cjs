const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin.from('agent_integrations').upsert({
    tenant_id: 'farmaciatrevo',
    last_seen: new Date().toISOString(),
    is_active: true
  }, { onConflict: 'tenant_id' });
  console.log(data, error);
}
run();
