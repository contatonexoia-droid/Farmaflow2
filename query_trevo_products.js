import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const targetIds = [
  "2vpk8joes", "lfjtagytb", "yei7010zp", "zhxid9qbe", "1v5b35jkg", "nj9qhuvlj",
  "aigcy0lmj", "iu1h63xcd", "ji8u5mc5h", "unsm4diqo", "ssyzcitf2", "p0odf3g25"
];

async function run() {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, barcode, tenant_id")
    .in("id", targetIds);

  if (error) {
    console.error("Error querying products:", error);
  } else {
    console.log("Products found in DB with those IDs:", data);
  }
}
run();
