import dotenv from 'dotenv';
dotenv.config();
console.log("VITE_SUPABASE_ANON_KEY:", process.env.VITE_SUPABASE_ANON_KEY ? "YES" : "NO");
