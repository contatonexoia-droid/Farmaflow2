import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data: profiles, error } = await supabaseAdmin.from('profiles').select('*');
  if (error) {
    console.error("ERROR:", error);
  } else {
    console.log("Profiles in DB:", profiles);
  }
}
run();
