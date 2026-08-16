import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'drogaria@123.com',
    password: '123'
  });
  if (authError) {
    console.error('Login failed:', authError);
    return;
  }
  
  console.log('User logged in:', authData.user.id);
  
  const { data, error } = await supabase.from('products').insert({
    tenant_id: 'nosso-catalogo',
    name: 'Test RLS Product',
    price: 10,
    stock: 10
  });
  console.log('insert result:', data, error);
}
run();
