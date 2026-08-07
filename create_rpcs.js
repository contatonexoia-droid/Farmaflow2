import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || ""; // We need the key

console.log("Supabase URL:", SUPABASE_URL);
