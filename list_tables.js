import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabaseAdmin.rpc('get_tables_list');
  if (error) {
    // If rpc doesn't exist, try querying postgres tables via SQL if we can, or just print keys from standard tables
    console.error("RPC Error, trying direct query if possible:", error);
    // Let's try select from pg_catalog or information_schema if RLS allows, but usually we can't do it via client unless RPC.
  } else {
    console.log("Tables:", data);
  }
}
run();
