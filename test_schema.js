import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public';
  `});
  console.log(data, error);
}
run();
