import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Before:");
  const { data: before } = await supabaseAdmin.from('agent_integrations').select('last_seen').eq('tenant_id', 'farmaciatrevo');
  console.log(before);

  const response = await fetch("http://localhost:3000/api/v1/integration/heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ apiKey: "farmaciatrevo" })
  });
  
  const text = await response.text();
  console.log("Response:", text);

  console.log("After:");
  const { data: after } = await supabaseAdmin.from('agent_integrations').select('last_seen').eq('tenant_id', 'farmaciatrevo');
  console.log(after);
}
run();
