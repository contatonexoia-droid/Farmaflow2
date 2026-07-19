import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('tenants').select('id, is_network_master, network_id').limit(5);
  console.log('tenants:', data, error);
}
run();
