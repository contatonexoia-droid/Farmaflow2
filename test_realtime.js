import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const channel = supabase.channel('erp-orders-channel');
channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
  console.log('Realtime Event:', payload);
});

channel.subscribe((status, err) => {
  console.log('Status:', status, err);
  if (status === 'SUBSCRIBED') {
    setTimeout(() => {
        console.log('Exiting...');
        process.exit(0);
    }, 2000);
  }
});
