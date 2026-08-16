import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';

async function run() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin@drogaria.com',
    password: 'farma123'
  });
  
  if (error) {
    console.error("Login failed:", error);
    return;
  }
  
  console.log("Logged in as:", data.user.email);
  
  // Find a valid tenant_id
  const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single();
  const tenant_id = tenant.id;
  console.log("Tenant:", tenant_id);
  
  const { data: insertData, error: insertError } = await supabase.from('products').upsert([
    { tenant_id, name: 'Test Product 2', price: 10.0 }
  ]);
  
  console.log("Upsert error:", insertError);
}
run();
