import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: users, error } = await supabase.from('tenant_users').select('*');
console.log("tenant_users count:", users ? users.length : 0);
if (users) {
  console.log("sample:", users.slice(0, 5));
}
