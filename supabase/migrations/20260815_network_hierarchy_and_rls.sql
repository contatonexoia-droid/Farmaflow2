-- ==============================================================================
-- FARMAFLOW: SUPABASE MIGRATION - HIERARQUIA DE REDES (MATRIZ / FILIAIS) & RLS MULTI-TENANT
-- ==============================================================================

-- 1. Criação da Tabela de Redes de Farmácias (Networks)
CREATE TABLE IF NOT EXISTS networks (
  id TEXT PRIMARY KEY DEFAULT ('net_' || substr(md5(random()::text), 1, 12)),
  name VARCHAR(150) NOT NULL,
  trade_name VARCHAR(150),
  cnpj_root VARCHAR(20),
  logo_url TEXT,
  primary_color VARCHAR(20) DEFAULT '#059669',
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Atualização da Tabela de Tenants (Lojas / Filiais)
ALTER TABLE IF EXISTS tenants 
ADD COLUMN IF NOT EXISTS network_id TEXT REFERENCES networks(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_network_master BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS branch_code VARCHAR(30),
ADD COLUMN IF NOT EXISTS branch_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS city VARCHAR(80),
ADD COLUMN IF NOT EXISTS state VARCHAR(10);

-- Índices de performance para busca por rede
CREATE INDEX IF NOT EXISTS idx_tenants_network_id ON tenants(network_id);
CREATE INDEX IF NOT EXISTS idx_tenants_network_master ON tenants(network_id, is_network_master);

-- 3. Criação e Atualização da Tabela de Usuários / Perfis (profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  network_id TEXT REFERENCES networks(id) ON DELETE SET NULL,
  email TEXT,
  name TEXT,
  role VARCHAR(50) DEFAULT 'operador',
  is_matrix_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garante que as colunas existem caso a tabela já existisse previamente
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tenant_id TEXT,
ADD COLUMN IF NOT EXISTS network_id TEXT REFERENCES networks(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'operador',
ADD COLUMN IF NOT EXISTS is_matrix_admin BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_network ON public.profiles(network_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles(tenant_id);

-- 4. Funções Auxiliares de Autenticação e Verificação de Permissão Hierárquica
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'tenant_id'),
    (SELECT tenant_id FROM profiles WHERE id = auth.uid()::text LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_network_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'network_id'),
    (SELECT network_id FROM profiles WHERE id = auth.uid()::text LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role'),
    (SELECT role FROM profiles WHERE id = auth.uid()::text LIMIT 1),
    'GUEST'
  );
$$;

-- Função Security Definer: Valida se o usuário autenticado tem acesso a uma loja específica
CREATE OR REPLACE FUNCTION public.user_has_tenant_access(target_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role TEXT;
  v_user_tenant_id TEXT;
  v_user_network_id TEXT;
  v_target_network_id TEXT;
BEGIN
  -- Super Admin global tem acesso total irrestrito
  v_role := public.current_user_role();
  IF v_role = 'super_admin' OR v_role = 'SUPER_ADMIN' THEN
    RETURN TRUE;
  END IF;

  -- Acesso direto à própria loja
  v_user_tenant_id := public.current_user_tenant_id();
  IF v_user_tenant_id IS NOT NULL AND v_user_tenant_id = target_tenant_id THEN
    RETURN TRUE;
  END IF;

  -- Usuário com perfil 'MATRIZ' ou 'admin_matriz' tem acesso a todas as lojas da sua rede
  v_user_network_id := public.current_user_network_id();
  IF (v_role IN ('MATRIZ', 'admin_matriz', 'network_admin', 'owner')) AND v_user_network_id IS NOT NULL THEN
    SELECT network_id INTO v_target_network_id FROM tenants WHERE id = target_tenant_id;
    IF v_target_network_id = v_user_network_id THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN FALSE;
END;
$$;

-- 5. Atualização de Políticas RLS (Row Level Security)

-- --- TABELA: TENANTS ---
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao de leitura de tenants por hierarquia" ON tenants;
CREATE POLICY "Permissao de leitura de tenants por hierarquia"
ON tenants FOR SELECT
TO authenticated, anon
USING (
  -- Leitura pública para catálogo do cliente ou validação hierárquica autenticada
  auth.role() = 'anon'
  OR public.user_has_tenant_access(id)
  OR network_id = public.current_user_network_id()
);

DROP POLICY IF EXISTS "Permissao de atualizacao de tenants pela Matriz" ON tenants;
CREATE POLICY "Permissao de atualizacao de tenants pela Matriz"
ON tenants FOR UPDATE
TO authenticated
USING (
  public.user_has_tenant_access(id)
)
WITH CHECK (
  public.user_has_tenant_access(id)
);

-- --- TABELA: CHAT_CONVERSATIONS ---
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao de leitura de conversas por hierarquia" ON chat_conversations;
CREATE POLICY "Permissao de leitura de conversas por hierarquia"
ON chat_conversations FOR SELECT
TO authenticated
USING (
  public.user_has_tenant_access(store_id)
);

DROP POLICY IF EXISTS "Permissao de atualizacao de conversas por hierarquia" ON chat_conversations;
CREATE POLICY "Permissao de atualizacao de conversas por hierarquia"
ON chat_conversations FOR UPDATE
TO authenticated
USING (
  public.user_has_tenant_access(store_id)
)
WITH CHECK (
  public.user_has_tenant_access(store_id)
);

-- --- TABELA: CHAT_MESSAGES ---
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao de leitura de mensagens por hierarquia" ON chat_messages;
CREATE POLICY "Permissao de leitura de mensagens por hierarquia"
ON chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chat_conversations c 
    WHERE c.id = chat_messages.conversation_id 
    AND public.user_has_tenant_access(c.store_id)
  )
);

-- --- TABELA: PRODUCTS ---
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao de produtos por hierarquia" ON products;
CREATE POLICY "Permissao de produtos por hierarquia"
ON products FOR ALL
TO authenticated
USING (
  public.user_has_tenant_access(tenant_id)
  OR tenant_id IS NULL -- Produtos globais/matriz
)
WITH CHECK (
  public.user_has_tenant_access(tenant_id)
  OR tenant_id IS NULL
);

-- --- TABELA: ORDERS ---
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao de pedidos por hierarquia" ON orders;
CREATE POLICY "Permissao de pedidos por hierarquia"
ON orders FOR ALL
TO authenticated
USING (
  public.user_has_tenant_access(tenant_id)
)
WITH CHECK (
  public.user_has_tenant_access(tenant_id)
);

-- 6. Trigger para manter updated_at na tabela networks
DROP TRIGGER IF EXISTS trg_update_networks_timestamp ON networks;
CREATE TRIGGER trg_update_networks_timestamp
BEFORE UPDATE ON networks
FOR EACH ROW
EXECUTE FUNCTION update_chat_conversation_timestamp();
