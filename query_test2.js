import { createClient } from '@supabase/supabase-js';
const supabase = createClient("https://nalshjhoiecxooejpiaw.supabase.co", process.env.SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy");
async function test() {
  const { data, error } = await supabase.from('products').select('*').limit(1);
  if (error) console.error(error);
  if (data) console.log(Object.keys(data[0]).join(", "));
}
test();
