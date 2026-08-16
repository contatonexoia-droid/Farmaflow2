import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getEnv = (key) => process.env[key] || '';
const SUPABASE_URL = getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder';
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabaseAdmin.from("medical_prescriptions").select("*").limit(1);
  if (error) {
    console.log("Table error:", error);
  } else {
    console.log("Table works!");
  }
}
run();
