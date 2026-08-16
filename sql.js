import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: `
    CREATE TABLE IF NOT EXISTS agent_integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id),
      activation_token TEXT,
      machine_id TEXT,
      is_active BOOLEAN DEFAULT true,
      last_seen TIMESTAMPTZ,
      branch_code TEXT,
      view_name TEXT DEFAULT 'VW_INTEGRACAO_FARMAFLOW',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `});
  console.log(data, error);
}
run();
