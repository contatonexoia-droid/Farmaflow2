import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  const { error: err1 } = await supabaseAnon.from('products').insert({
    tenant_id: 'maxima-popular',
    name: 'Test Matriz',
    price: 10,
    stock: 10
  });
  console.log('insert matriz without auth:', err1);
}
run();
