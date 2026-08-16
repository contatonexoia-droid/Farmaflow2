import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase.from('tenants').select('*').limit(1);
  console.log("Tenants:", data);
  console.log("Error:", error);
}
run();
