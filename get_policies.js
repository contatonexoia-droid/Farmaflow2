const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';
const supabase = createClient(supabaseUrl, supabaseKey);
// We can't query pg_policies with anon key. But maybe we can run it on the server using internal endpoint?
