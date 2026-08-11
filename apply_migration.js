import pkg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pkg;

const regions = [
  'sa-east-1',
  'us-east-1',
  'us-west-1',
  'us-west-2',
  'us-east-2',
  'eu-central-1',
  'eu-west-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'eu-west-2',
  'eu-west-3',
  'ca-central-1'
];

async function tryConnect() {
  const sqlPath = path.join(process.cwd(), 'teams_and_inboxes_migration.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@${host}:6543/postgres`;

    console.log(`Trying connection to region: ${region} (${host})...`);
    const client = new Client({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });

    try {
      await client.connect();
      console.log(`\n🎉 SUCCESS! Connected to region: ${region}`);
      
      console.log("Executing SQL migration statements...");
      await client.query(sqlContent);
      console.log("Migration executed successfully!");
      
      await client.end();
      return;
    } catch (err) {
      console.log(`❌ Failed for region ${region}: ${err.message}`);
      try {
        await client.end();
      } catch (e) {}
    }
  }

  console.error("\n💥 ALL 15 REGIONS FAILED. Could not establish a database connection.");
  process.exit(1);
}

tryConnect();
