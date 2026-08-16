import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkTable(tableName) {
  const { data, error } = await supabase.from(tableName).select('*').limit(1);
  if (error) {
    console.log(`❌ Table ${tableName} error:`, error.code, error.message);
  } else {
    console.log(`✅ Table ${tableName} exists! Rows:`, data.length);
  }
}

async function run() {
  await checkTable('chat_teams');
  await checkTable('chat_team_members');
  await checkTable('inboxes');
  await checkTable('inbox_teams');
  await checkTable('chat_conversations');
}

run();
