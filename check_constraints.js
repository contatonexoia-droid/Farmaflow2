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
    body: JSON.stringify({ query: "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND conrelid::regclass::text = 'products';" })
  });
  const data = await response.json();
  console.log("Constraints:", data);
}
run();
