import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

async function run() {
  const url = `${SUPABASE_URL}/rest/v1/`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY
    }
  });
  const data = await response.json();
  const paths = Object.keys(data.paths || {});
  const rpcs = paths.filter(p => p.startsWith('/rpc/'));
  console.log("Exposed RPC functions:", rpcs);
}

run();
