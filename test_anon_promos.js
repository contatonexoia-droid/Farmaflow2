import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabaseAnon
    .from("promotions")
    .select("*")
    .eq("tenant_id", "farmaciatrevo");

  if (error) {
    console.error("ANON ERROR:", error);
  } else {
    console.log("ANON SUCCESS! Count:", data.length);
    console.log("Promotions returned:", data.map(p => ({ id: p.id, name: p.name, isActive: p.is_active })));
  }
}
run();
