import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  const { data: user, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: 'test_rls@example.com',
    password: 'password123',
    email_confirm: true,
  });
  
  if (createError && !createError.message.includes('already registered')) {
    console.error('Create error:', createError);
  }
  
  const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
    email: 'test_rls@example.com',
    password: 'password123'
  });
  
  console.log('User logged in:', authData.user?.id);
  
  // Set tenant_users
  await supabaseAdmin.from('tenant_users').upsert({
    supabase_user_id: authData.user.id,
    tenant_id: 'maxima-popular',
    email: 'test_rls@example.com',
    name: 'Test',
    role: 'owner'
  }, { onConflict: 'tenant_id,email' });

  // Test insert to matriz
  const { error: err1 } = await supabaseAnon.from('products').insert({
    tenant_id: 'maxima-popular',
    name: 'Test Matriz',
    price: 10,
    stock: 10
  });
  console.log('insert matriz:', err1);
  
  // Test insert to filial
  const { error: err2 } = await supabaseAnon.from('products').insert({
    tenant_id: 'maxima-popular-filial-unamar',
    name: 'Test Filial',
    price: 10,
    stock: 10
  });
  console.log('insert filial:', err2);
  
  await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
}
run();
