require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('products').select('*').limit(3000);
  if (error) { console.error(error); return; }
  console.log("Total products:", data.length);
  const shampoos = data.filter(p => {
    const name = (p.name || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    return name.includes('sh') || cat.includes('sh');
  });
  console.log("Shampoos:");
  console.log(shampoos.slice(0, 10).map(p => ({name: p.name, category: p.category})));
}
run();
