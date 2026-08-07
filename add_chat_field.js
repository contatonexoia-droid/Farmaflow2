import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_chat_enabled BOOLEAN DEFAULT false;' });
  console.log("RPC Error:", error);
  // Alternative if rpc not available: we can't alter table via REST easily. We could just add the field to our mock / server data if it's not strictly typing or try to update a row to see if it allows the field. Wait, Supabase allows schema changes via SQL only, so we must execute SQL. If `exec_sql` is not defined, we might need a workaround.
}
run();
