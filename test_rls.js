import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: { user }, error: authErr } = await supabase.auth.admin.getUserById('90478e50-3ebf-4597-9d2a-c1332aedb517');
console.log("User:", user?.email);
