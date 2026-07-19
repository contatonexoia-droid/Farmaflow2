import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: 'admin@drogaria.com',
    password: 'farma123',
    email_confirm: true,
  });
  console.log(data, error);
}
run();
