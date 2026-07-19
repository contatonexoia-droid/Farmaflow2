import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'contato.nexoia@gmail.com',
    password: 'password_here?' // I don't know the password
  });
  
  console.log("Upsert error:", error);
}
run();
