import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';
async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let query = supabase.from("promotions").select("*").or(`tenant_id.eq.filial-a,tenant_id.eq.matriz`);
  const { data, error } = await query;
  console.log("promotions:", data, error);
}
run();
