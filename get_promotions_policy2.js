const url = 'https://nalshjhoiecxooejpiaw.supabase.co/rest/v1/rpc/exec_sql';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function run() {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key
    },
    body: JSON.stringify({ query: "SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'promotions';" })
  });
  const data = await response.json();
  console.log("promotions policies:", data);
}
run();
