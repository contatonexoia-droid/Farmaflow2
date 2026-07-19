
import React, { useState } from 'react';
import { AuthSession, PharmacyConfig } from '../types';
import { supabase } from '../services/supabase';
import { mapDbTenantToApp } from '../services/storage';
import { ShieldCheck, Lock, User, ArrowRight, Eye, EyeOff, Store, Globe, Loader2 } from 'lucide-react';

interface LoginProps {
  onLogin: (session: AuthSession, tenant?: PharmacyConfig) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Credenciais Super Admin atualizadas
  const SUPER_ADMIN_EMAIL = 'admin@drogaria.com';
  const SUPER_ADMIN_PASS = 'farma123';

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
        if (email === SUPER_ADMIN_EMAIL && password === SUPER_ADMIN_PASS) {
            const { data: authData } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password: password
            });
            onLogin({ 
                type: 'SUPER_ADMIN',
                access_token: authData?.session?.access_token,
                refresh_token: authData?.session?.refresh_token
            });
            return;
        }

        // 1. Tentar Login usando o Supabase Auth (Para contas antigas criadas via painel do Supabase)
        let validTenant = null;
        let authUserId = null;

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password
        });

        if (!authError && authData.user) {
            authUserId = authData.user.id;
            let tenantIdToCheck = authData.user.user_metadata?.tenant_id || authUserId;

            // 2. Buscar os dados da farmácia (Como o RLS está ativo, ele só achará a dele)
            const { data: rawTenant } = await supabase
                .from('tenants')
                .select('*')
                .eq('id', tenantIdToCheck)
                .single();
            
            if (rawTenant) {
               validTenant = rawTenant;
               // Obter role do funcionário se houver, ou assumir owner
               const userRole = authData.user.user_metadata?.role || "owner";
               
               // Se der ok, já repassa
               onLogin({ 
                   type: 'PHARMACY_ADMIN', 
                   tenantId: validTenant.id, 
                   role: userRole as any,
                   access_token: authData.session?.access_token,
                   refresh_token: authData.session?.refresh_token
               } as any, mapDbTenantToApp(validTenant));
               return; // Skip fallback
            } else {
               await supabase.auth.signOut();
            }
        }
        
        let tokens: any = {};
        
        // 3. Fallback: Contas criadas via SuperAdmin (Tabela Tenants nativa via RPC bypass RLS)
        if (!validTenant) {
            const { data: rpcTenant, error: rpcError } = await supabase.rpc('admin_login', {
                input_email: email.trim().toLowerCase(),
                input_password: password
            });

            if (rpcError || !rpcTenant) {
                setError('E-mail ou senha incorretos.');
                return;
            }
            
            validTenant = rpcTenant;

            try {
               // Hit the backend to migrate this legacy owner, which will create the Supabase Auth user
               // so they have a valid Bearer token!
               const migrateRes = await fetch(`/api/v1/auth/migrate-legacy`, {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ email: email.trim().toLowerCase(), password, tenantId: validTenant.id })
               });
               if (migrateRes.ok) {
                   // Retry sign in to get the local session
                   const { data: newAuth } = await supabase.auth.signInWithPassword({
                       email: email.trim().toLowerCase(),
                       password: password
                   });
                   if (newAuth?.session) {
                       tokens.access_token = newAuth.session.access_token;
                       tokens.refresh_token = newAuth.session.refresh_token;
                   }
               }
            } catch(e) {
               console.warn("Migration failed but continuing with fallback", e);
            }
        }

        const tenant = mapDbTenantToApp(validTenant);

        onLogin({ type: 'PHARMACY_ADMIN', tenantId: tenant.id, role: 'owner', ...tokens } as any, tenant);

    } catch (err: any) {
        console.error(err);
        setError('Erro ao processar login.');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-in zoom-in-95 duration-500">
        
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-emerald-600 shadow-emerald-200 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl mx-auto mb-6">
             <Store size={40} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">
            Portal FarmaFlow
          </h1>
          <p className="text-gray-500 mt-2 font-medium">
            Acesso administrativo para drogarias.
          </p>
        </div>

        <div className="bg-white p-10 rounded-[3rem] border-2 border-gray-50 shadow-2xl space-y-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-emerald-500" />

          <form onSubmit={handleAuth} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1 flex items-center gap-2">
                <User size={12}/> E-mail
              </label>
              <input 
                type="email"
                className="w-full bg-gray-50 border-2 border-transparent rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black focus:border-emerald-500"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1 flex items-center gap-2">
                <Lock size={12}/> Senha
              </label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"}
                  className="w-full bg-gray-50 border-2 border-transparent rounded-2xl py-4 pl-6 pr-14 outline-none transition-all font-bold text-black focus:border-emerald-500"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-600 transition-colors p-1"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {error && <p className="text-red-500 text-xs font-bold text-center animate-bounce bg-red-50 py-2 rounded-lg">{error}</p>}

            <button 
              type="submit"
              disabled={loading}
              className="w-full text-white py-5 rounded-3xl font-black text-lg flex items-center justify-center gap-3 hover:brightness-110 active:scale-95 transition-all shadow-xl disabled:opacity-70 disabled:cursor-not-allowed bg-emerald-600 shadow-emerald-100"
            >
              {loading ? <Loader2 className="animate-spin" size={24} /> : <>Entrar no Painel <ArrowRight size={20}/></>}
            </button>
          </form>
        </div>
        
        <p className="text-center text-gray-400 text-xs mt-10 font-bold uppercase tracking-widest flex items-center justify-center gap-2">
          <Globe size={12} /> Acesso Restrito
        </p>
      </div>
    </div>
  );
};
