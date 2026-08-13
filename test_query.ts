import { supabaseAdmin } from './server';
console.log("Service key:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "EXISTS" : "MISSING");
