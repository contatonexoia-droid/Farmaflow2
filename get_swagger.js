import dotenv from 'dotenv';
dotenv.config();

const url = "https://nalshjhoiecxooejpiaw.supabase.co/rest/v1/";
const key = "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

async function run() {
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    if (!res.ok) {
      console.log("REST call failed with status:", res.status);
      return;
    }
    const spec = await res.json();
    console.log("Swagger title:", spec.info?.title);
    const paths = Object.keys(spec.paths || {});
    console.log("Paths available:", paths.filter(p => p.startsWith('/rpc/')));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
