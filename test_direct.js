import pkg from 'pg';
const { Client } = pkg;

const connectionString = "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@db.nalshjhoiecxooejpiaw.supabase.co:5432/postgres";

async function run() {
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    console.log("Connected directly with dot username!");
    await client.end();
  } catch (err) {
    console.error("Connection failed:", err);
  }
}
run();
