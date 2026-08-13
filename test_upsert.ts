import { createClient } from '@supabase/supabase-js';
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
async function run() {
  const { data: p } = await supabaseAdmin.from('products').select('*').limit(1).single();
  if(p) {
      const { error } = await supabaseAdmin.from('products').upsert({...p, requires_prescription: true});
      console.log("Upsert error:", error);
  }
}
run();
