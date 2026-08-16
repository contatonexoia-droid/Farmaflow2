import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkRealtime() {
  const { data, error } = await supabase.rpc('get_realtime_publications');
  console.log('Realtime Publications:', data, error);
}
checkRealtime();
