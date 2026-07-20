import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pkg;

const connectionString = process.env.DATABASE_URL || "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

async function run() {
  console.log("Tentando conectar ao banco de dados com a string:", connectionString.replace(/:[^:@]+@/, ":****@"));
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Conectado com sucesso ao PostgreSQL!");

    const sqlPath = path.join(process.cwd(), 'intelligent_search_setup.sql');
    console.log(`Lendo: ${sqlPath}`);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log("Executando consultas SQL...");
    await client.query(sqlContent);
    console.log("SQL executado com sucesso no banco de dados!");

  } catch (err) {
    console.error("Erro ao executar SQL:", err);
  } finally {
    await client.end();
  }
}

run();
