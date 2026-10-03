import path from 'path';
import { defineConfig, loadEnv } from 'vite';
// @ts-ignore
import react from '@vitejs/plugin-react';
// @ts-ignore
import tailwindcss from '@tailwindcss/vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      plugins: [
        react(),
        tailwindcss(),
        viteCompression({
          algorithm: 'brotliCompress',
          ext: '.br',
        }),
        viteCompression({
          algorithm: 'gzip',
          ext: '.gz',
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co'),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy'),
        'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co'),
        'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
        dedupe: ['react', 'react-dom']
      }
    };
});
