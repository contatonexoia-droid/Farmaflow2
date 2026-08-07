import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pkg;

// List of all possible Supabase AWS regions
const regions = [
  'sa-east-1',      // South America (São Paulo) - very common for Brazilian apps (FarmaFlow)
  'us-east-1',      // N. Virginia
  'us-west-1',      // N. California
  'us-west-2',      // Oregon
  'us-east-2',      // Ohio
  'eu-central-1',   // Frankfurt
  'eu-west-1',      // Ireland
  'ap-southeast-1'  // Singapore
];

async function tryConnect() {
  const sqlPath = path.join(process.cwd(), 'fix_inboxes_recursion_and_whatsapp_unique.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    // We try port 6543 (transaction pooler)
    const connectionString = `postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@${host}:6543/postgres`;

    console.log(`Trying connection to region: ${region} (${host})...`);
    const client = new Client({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000 // 5 seconds timeout
    });

    try {
      await client.connect();
      console.log(`\n🎉 SUCCESS! Connected to region: ${region}`);
      
      console.log("Executing SQL migration statements...");
      await client.query(sqlContent);
      console.log("Migration executed successfully!");
      
      await client.end();
      return; // Stop after successful migration
    } catch (err) {
      console.log(`❌ Failed for region ${region}: ${err.message}`);
      try {
        await client.end();
      } catch (e) {}
    }
  }

  console.error("\n💥 ALL REGIONS FAILED. Could not establish a database connection.");
  process.exit(1);
}

tryConnect();
