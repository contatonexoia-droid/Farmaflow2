import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: orders, error } = await supabase.from('orders').select('*');
console.log("Error:", error);
console.log("Orders count:", orders ? orders.length : 0);
