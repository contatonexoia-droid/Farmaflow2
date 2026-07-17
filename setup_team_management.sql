CREATE TYPE user_role AS ENUM ('owner', 'admin', 'gerente', 'operador', 'entregador');

CREATE TABLE IF NOT EXISTS tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_user_id UUID, -- Optional foreign key to auth.users if needed, typically UUID or TEXT depending on Supabase setup
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'operador',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir gerenciamento apenas para membros do próprio tenant" ON tenant_users;
CREATE POLICY "Permitir gerenciamento apenas para membros do próprio tenant" 
ON tenant_users
FOR ALL
USING (
  tenant_id = auth.uid()::text 
  OR 
  tenant_id = (auth.jwt() ->> 'user_metadata')::jsonb ->> 'tenant_id'
);
