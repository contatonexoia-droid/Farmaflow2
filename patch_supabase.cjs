const fs = require('fs');
let code = fs.readFileSync('services/supabase.ts', 'utf8');

const targetStr = `export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co', 
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: false, // Desabilita persistência automática para evitar erros de LockManager em iframes
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);`;

const newStr = `// Safe storage adapter para evitar crash de IndexedDB / LockManager em iframes
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
  SUPABASE_URL || 'https://placeholder.supabase.co', 
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: true, // Ativado, usando o custom storage
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: customStorageAdapter
    }
  }
);`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('services/supabase.ts', code);
