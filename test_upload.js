import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getEnv = (key) => process.env[key] || '';
const SUPABASE_URL = getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Uploading file...");
  const fileName = `test/test-${Date.now()}.txt`;
  const { data, error } = await supabaseAdmin.storage
        .from("medical-prescriptions")
        .upload(fileName, Buffer.from("test content"), {
          contentType: "text/plain",
          upsert: false,
        });
  if (error) {
    console.error("Upload error:", error);
  } else {
    console.log("Uploaded!", data);
  }
}
run();
