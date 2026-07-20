import dotenv from 'dotenv';
dotenv.config();
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "CONFIGURED (length " + process.env.SUPABASE_SERVICE_ROLE_KEY.length + ")" : "NOT CONFIGURED");
console.log("VITE_SUPABASE_URL:", process.env.VITE_SUPABASE_URL);
console.log("VITE_SUPABASE_ANON_KEY:", process.env.VITE_SUPABASE_ANON_KEY ? "CONFIGURED" : "NOT CONFIGURED");
