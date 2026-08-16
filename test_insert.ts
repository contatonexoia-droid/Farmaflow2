import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
);
// We can't insert without auth, but let's just see if we can read
