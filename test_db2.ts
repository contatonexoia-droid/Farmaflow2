import { createClient } from '@supabase/supabase-js';
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
async function run() {
  const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
  console.log("Users:", users.users.map(u => ({ id: u.id, email: u.email, meta: u.user_metadata })).slice(0, 5));
}
run();
