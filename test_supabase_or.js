import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testQuery(tenantId, networkId) {
  console.log(`Testing unquoted or filter for: ${tenantId}, ${networkId}`);
  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .or(`tenant_id.eq.${tenantId},tenant_id.eq.${networkId}`);

    if (error) {
      console.error("Unquoted Query Error:", error);
    } else {
      console.log("Unquoted Query Success! Returned count:", data.length);
    }
  } catch (e) {
    console.error("Unquoted Query Catch:", e);
  }

  console.log(`\nTesting quoted or filter for: ${tenantId}, ${networkId}`);
  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .or(`tenant_id.eq."${tenantId}",tenant_id.eq."${networkId}"`);

    if (error) {
      console.error("Quoted Query Error:", error);
    } else {
      console.log("Quoted Query Success! Returned count:", data.length);
    }
  } catch (e) {
    console.error("Quoted Query Catch:", e);
  }
}

testQuery("farmaciatrevo", "farmacia-trevo");
