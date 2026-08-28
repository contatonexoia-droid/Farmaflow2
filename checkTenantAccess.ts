import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_KEY);

export const checkTenantAccess = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const authHeader = req.headers.authorization;
  const routeTenantId = req.params.tenantId || req.query.tenantId || (req.headers['x-tenant-id'] as string);

  // 1. If Bearer token is provided, attempt Supabase Auth validation
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
      
      if (!error && user) {
        const userTenantId = user.user_metadata?.tenant_id || user.user_metadata?.store_id;
        const userRole = user.user_metadata?.role;
        let isAuthorized = false;

        // 1. Matches metadata tenant_id
        if (userTenantId && userTenantId === routeTenantId) {
          isAuthorized = true;
        }

        // 2. Super admin emails bypass
        const superAdmins = ['contato.nexoia@gmail.com', 'admin@drogaria.com'];
        if (user.email && superAdmins.includes(user.email.toLowerCase())) {
          isAuthorized = true;
        }

        // 3. User email is the tenant's admin_email
        if (!isAuthorized && user.email && routeTenantId) {
          try {
            const { data: tenantData } = await supabaseAuth
              .from('tenants')
              .select('id, admin_email, is_network_master, network_id')
              .eq('id', routeTenantId)
              .single();
            
            if (tenantData && tenantData.admin_email && tenantData.admin_email.toLowerCase() === user.email.toLowerCase()) {
              isAuthorized = true;
            }
          } catch (err) {
            console.error('Error verifying tenant admin email:', err);
          }
        }

        // 4. Check if user is a Matriz Administrator accessing a branch of their network
        if (!isAuthorized && routeTenantId) {
          try {
            let userStore: any = null;
            if (userTenantId) {
              const { data } = await supabaseAuth
                .from('tenants')
                .select('id, is_network_master, network_id, admin_email')
                .eq('id', userTenantId)
                .single();
              userStore = data;
            }
            if (!userStore && user.email) {
              const { data } = await supabaseAuth
                .from('tenants')
                .select('id, is_network_master, network_id, admin_email')
                .eq('admin_email', user.email.toLowerCase())
                .single();
              userStore = data;
            }

            const isMatrixUserRole = userRole && (
              userRole.toLowerCase() === 'matriz' || 
              userRole.toLowerCase() === 'admin_matriz' ||
              userRole.toLowerCase() === 'network_admin' ||
              userRole.toLowerCase() === 'owner' ||
              userRole.toLowerCase() === 'super_admin'
            );

            if (userStore?.is_network_master || isMatrixUserRole) {
              if (userStore && userStore.id === routeTenantId) {
                isAuthorized = true;
              } else {
                const { data: targetStore } = await supabaseAuth
                  .from('tenants')
                  .select('id, network_id')
                  .eq('id', routeTenantId)
                  .single();

                if (targetStore && (
                  targetStore.network_id === userStore?.id || 
                  targetStore.id === userStore?.id ||
                  (userStore?.network_id && targetStore.network_id === userStore.network_id)
                )) {
                  isAuthorized = true;
                }
              }
            }
          } catch (err) {
            console.error('Error verifying network tenant access:', err);
          }
        }

        // 5. Default fallback (User ID equals routeTenantId)
        if (!isAuthorized && user.id === routeTenantId) {
          isAuthorized = true;
        }

        if (isAuthorized) {
          const writeMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
          if (writeMethods.includes(req.method)) {
            const allowedRoles = ['admin', 'owner', 'gerente', 'matriz', 'admin_matriz', 'network_admin', 'super_admin', 'pharmacy_admin'];
            const lowercaseRole = userRole ? userRole.toLowerCase() : null;
            const isSuperAdminUser = user.email && superAdmins.includes(user.email.toLowerCase());
            
            if (!isSuperAdminUser && lowercaseRole && !allowedRoles.includes(lowercaseRole)) {
              return res.status(403).json({ error: 'Acesso restrito a administradores e gerentes.' });
            }
          }

          (req as any).user = user;
          return next();
        }
      }
    } catch (err) {
      console.warn('Supabase Auth verification error in checkTenantAccess:', err);
    }
  }

  // 2. Fallback: Validate tenant from database if tenantId is provided
  if (routeTenantId) {
    try {
      const { data: tenantData, error: tenantErr } = await supabaseAuth
        .from('tenants')
        .select('id, is_blocked, is_network_master, network_id, admin_email')
        .eq('id', routeTenantId)
        .single();

      if (!tenantErr && tenantData) {
        if (tenantData.is_blocked) {
          return res.status(403).json({ error: 'Acesso suspenso para esta unidade.' });
        }
        (req as any).tenant = tenantData;
        return next();
      }
    } catch (err) {
      console.error('Error validating tenant existence in checkTenantAccess:', err);
    }
  }

  return res.status(401).json({ error: 'Token de autenticação não fornecido ou inválido. Faça login novamente para continuar.' });
};
