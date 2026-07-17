import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_KEY);

export const checkTenantAccess = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido ou inválido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Token expirado ou inválido.' });
    }

    const routeTenantId = req.params.tenantId;
    const userTenantId = user.user_metadata?.tenant_id;
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
          .select('admin_email')
          .eq('id', routeTenantId)
          .single();
        
        if (tenantData && tenantData.admin_email && tenantData.admin_email.toLowerCase() === user.email.toLowerCase()) {
          isAuthorized = true;
        }
      } catch (err) {
        console.error('Error verifying tenant admin email:', err);
      }
    }

    // 4. Default fallback
    if (!isAuthorized && user.id === routeTenantId) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Acesso negado: Isolamento de tenant violado.' });
    }

    const writeMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (writeMethods.includes(req.method)) {
      const allowedRoles = ['admin', 'owner', 'gerente'];
      const lowercaseRole = userRole ? userRole.toLowerCase() : null;
      // Accept writes if user is super admin, OR if they match the admin_email, OR if they have authorized role
      const isSuperAdminUser = user.email && superAdmins.includes(user.email.toLowerCase());
      
      // If they are not super admin, we check their role
      if (!isSuperAdminUser && lowercaseRole && !allowedRoles.includes(lowercaseRole)) {
         return res.status(403).json({ error: 'Acesso restrito a administradores e gerentes.' });
      }
    }

    (req as any).user = user;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro interno ao validar autorização.' });
  }
};
