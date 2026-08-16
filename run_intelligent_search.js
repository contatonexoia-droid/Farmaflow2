import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Erro: VITE_SUPABASE_URL/SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não estão configurados nas variáveis de ambiente.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function run() {
  try {
    const sqlPath = path.join(process.cwd(), 'intelligent_search_setup.sql');
    console.log(`Lendo o arquivo SQL de: ${sqlPath}`);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log("Executando script SQL no banco de dados via RPC 'exec_sql'...");
    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });

    if (error) {
      console.error("Erro ao executar SQL:", error);
      process.exit(1);
    }

    console.log("SQL executado com sucesso no banco de dados!");
    console.log("Retorno do RPC:", data);
  } catch (err) {
    console.error("Falha inesperada:", err);
    process.exit(1);
  }
}

run();
