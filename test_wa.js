import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy');
async function run() {
  const { data, error } = await supabase.from('whatsapp_instances').select('*').limit(1);
  console.log('WA Data:', data);
  console.log('Error:', error);
}
run();
