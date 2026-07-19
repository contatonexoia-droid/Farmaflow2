import pkg from 'pg';
const { Client } = pkg;

const conString = "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

async function run() {
  const client = new Client({
    connectionString: conString,
  });
  try {
    await client.connect();
    console.log("Connected to PostgreSQL successfully!");
    const res = await client.query("SELECT version();");
    console.log("PostgreSQL Version:", res.rows[0]);
    await client.end();
  } catch (err) {
    console.error("Connection failed:", err);
  }
}
run();
