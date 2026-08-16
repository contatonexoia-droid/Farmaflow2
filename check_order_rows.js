import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getEnv = (key) => process.env[key] || '';
const SUPABASE_URL = getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', '8GJPFAIXO');
  if (error) {
    console.error(error);
    return;
  }
  console.log(`Found ${data.length} rows for id 8GJPFAIXO:`);
  console.log(JSON.stringify(data, null, 2));
}
run();
