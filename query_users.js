import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

async function run() {
  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) {
    console.error("ERROR:", error);
  } else {
    const summary = users.users.map(u => ({ email: u.email, metadata: u.user_metadata }));
    console.log("All users:", JSON.stringify(summary, null, 2));
  }
}
run();
