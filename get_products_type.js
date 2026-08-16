const url = 'https://nalshjhoiecxooejpiaw.supabase.co/rest/v1/products?select=id&limit=1';
const key = process.env.SUPABASE_ANON_KEY;

async function run() {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'
    }
  });
  const data = await response.json();
  console.log("Data:", data);
}
run();
