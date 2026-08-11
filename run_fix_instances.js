import pkg from 'pg';
import fs from 'fs';
import path from 'path';
const { Client } = pkg;
const connectionString = "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@aws-0-us-west-1.pooler.supabase.com:6543/postgres";
async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sqlContent = fs.readFileSync('fix_instances.sql', 'utf8');
  await client.query(sqlContent);
  await client.end();
}
run();
