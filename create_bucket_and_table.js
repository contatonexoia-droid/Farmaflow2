import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const getEnv = (key) => process.env[key] || '';
const SUPABASE_URL = getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY') || 'placeholder';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Checking bucket...");
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
  if (listError) console.error("List error:", listError);
  
  const prescriptionsExists = buckets?.some((b) => b.id === "medical-prescriptions");
  if (!prescriptionsExists) {
    console.log("[Storage] Creating bucket 'medical-prescriptions'...");
    const { error: createError } = await supabaseAdmin.storage.createBucket("medical-prescriptions", {
      public: true,
      fileSizeLimit: 10485760, // 10MB
      allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf", "image/webp"],
    });
    if (createError) console.error("Create bucket error:", createError);
  } else {
    console.log("Bucket already exists.");
  }

  // To create the table, we'd need postgres access.
}
run();
