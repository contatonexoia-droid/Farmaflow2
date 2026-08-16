import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase.rpc('user_can_modify_tenant', { target_tenant_id: 'nosso-catalogo' });
console.log("Result:", data, "Error:", error);
