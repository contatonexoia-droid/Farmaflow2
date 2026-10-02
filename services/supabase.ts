
import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string): string => {
  const altKey = key.startsWith('VITE_') ? key.replace('VITE_', '') : `VITE_${key}`;

  // Tenta import.meta.env (Vite)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      if (import.meta.env[key]) return String(import.meta.env[key]);
      // @ts-ignore
      if (import.meta.env[altKey]) return String(import.meta.env[altKey]);
    }
  } catch (e) {}

  // Tenta window.process.env (shim comum em ambientes web)
  try {
    // @ts-ignore
    if (typeof window !== 'undefined' && window.process?.env) {
      // @ts-ignore
      if (window.process.env[key]) return String(window.process.env[key]);
      // @ts-ignore
      if (window.process.env[altKey]) return String(window.process.env[altKey]);
    }
  } catch (e) {}

  // Tenta process.env (Node ou shims de build)
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env[key]) return String(process.env[key]);
      if (process.env[altKey]) return String(process.env[altKey]);
    }
  } catch (e) {}

  return '';
};

const SUPABASE_URL = (getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || 'https://nalshjhoiecxooejpiaw.supabase.co').trim();
const SUPABASE_ANON_KEY = (getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY') || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy').trim();

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

// Safe storage adapter para evitar crash de IndexedDB / LockManager em iframes
const customStorageAdapter = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      console.warn('Fallback memory storage get:', key);
      return null;
    }
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      console.warn('Fallback memory storage set:', key);
    }
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      console.warn('Fallback memory storage remove:', key);
    }
  }
};

export const supabase = createClient(
  SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co', 
  SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy',
  {
    auth: {
      persistSession: true, // Ativado, usando o custom storage
      autoRefreshToken: true,
      detectSessionInUrl: false, // Desativado para evitar requisições espúrias a cada URL de produto/deep-link
      storage: customStorageAdapter
    }
  }
);
