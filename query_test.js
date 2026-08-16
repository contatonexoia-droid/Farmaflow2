import { createClient } from '@supabase/supabase-js';
const supabase = createClient("https://nalshjhoiecxooejpiaw.supabase.co", process.env.SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy");
console.log("Ready");
