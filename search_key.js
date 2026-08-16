import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getEnv = (key) => process.env[key] || '';
const SUPABASE_URL = getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const tables = ['products', 'orders', 'tenants', 'promotions', 'coupons', 'tenant_users', 'departments'];
  for (const table of tables) {
    try {
      console.log(`Checking table: ${table}...`);
      const { data, error } = await supabaseAdmin.from(table).select('*');
      if (error) {
        console.error(`Error selecting from ${table}:`, error);
        continue;
      }
      if (!data) continue;
      for (const row of data) {
        const rowStr = JSON.stringify(row);
        if (rowStr.includes('8GJPFAIXO')) {
          console.log(`FOUND IN TABLE ${table}!`);
          console.log(JSON.stringify(row, null, 2));
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
}
run();
