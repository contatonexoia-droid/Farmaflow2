import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const sql = fs.readFileSync('fix_promotions_coupons_rls.sql', 'utf8');
  
  // Create a temporary function to execute arbitrary SQL
  const { data, error } = await supabase.rpc('exec_sql', { query: sql });
  
  if (error) {
    console.error("Error executing SQL via RPC:", error);
    // Alternative: Maybe the admin panel allows it?
  } else {
    console.log("SQL executed successfully:", data);
  }
}
run();
