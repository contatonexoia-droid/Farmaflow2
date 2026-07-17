
import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string): string => {
  // Tenta window.process.env (shim comum em ambientes web)
  try {
    // @ts-ignore
    if (typeof window !== 'undefined' && window.process?.env?.[key]) {
      // @ts-ignore
      return window.process.env[key];
    }
  } catch (e) {}

  // Tenta process.env (Node ou shims de build)
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key] as string;
    }
  } catch (e) {}

  // Tenta import.meta.env (Vite)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {}

  return '';
};

const SUPABASE_URL = (getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co').trim();
const SUPABASE_ANON_KEY = (getEnv('SUPABASE_ANON_KEY') || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy').trim();

export const isSupabaseConfigured = () => {
  const isUrlValid = !!SUPABASE_URL && SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('placeholder');
  const isKeyValid = !!SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length > 10 && SUPABASE_ANON_KEY !== 'placeholder';
  return isUrlValid && isKeyValid;
};

// Log silencioso mas informativo para o desenvolvedor
if (typeof window !== 'undefined') {
  if (isSupabaseConfigured()) {
    console.log("%c[Supabase] ✅ Configurações detectadas.", "color: #059669; font-weight: bold;");
  } else {
    console.warn("%c[Supabase] ⚠️ Aguardando configuração de URL e KEY.", "color: #d97706; font-weight: bold;");
  }
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co', 
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: false, // Desabilita persistência automática para evitar erros de LockManager em iframes
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);
