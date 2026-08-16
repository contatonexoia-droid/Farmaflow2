import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: `
    ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_chat_enabled BOOLEAN DEFAULT false;
  `});
  console.log("Execute SQL Result:", data, error);
}
run();
