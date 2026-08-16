import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
const { Client } = pkg;
const connectionString = process.env.DATABASE_URL || "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@aws-0-us-west-1.pooler.supabase.com:6543/postgres";
async function run() {
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    const sqlPath = path.join(process.cwd(), 'database_fix_chat.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sqlContent);
    console.log("SQL executado com sucesso!");
  } catch (err) {
    console.error("Erro ao executar SQL:", err);
  } finally {
    await client.end();
  }
}
run();
