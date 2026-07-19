import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('tenant_users').select('*').limit(5);
  console.log('tenant_users:', data, error);
}
run();
