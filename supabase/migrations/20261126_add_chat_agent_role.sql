-- ==============================================================================
-- FARMAFLOW: MIGRATION - PERFIL "ATENDENTE DE CHAT" (chat_agent) E TRAVAS RBAC
-- ==============================================================================
-- Seguro para execução repetida (idempotente) no SQL Editor do Supabase.
-- ==============================================================================

-- 1. Garantir colunas e backfill de created_at / is_active em public.tenant_users
ALTER TABLE IF EXISTS public.tenant_users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.tenant_users
SET created_at = NOW()
WHERE created_at IS NULL;

-- 2. Converter tenant_users.role de ENUM (user_role) para TEXT (se aplicável)
--    e remover constraints CHECK antigas que bloqueavam 'chat_agent'
DO $$
DECLARE
  v_udt_name TEXT;
  v_con RECORD;
BEGIN
  SELECT c.udt_name INTO v_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'tenant_users'
    AND c.column_name = 'role';

  IF v_udt_name = 'user_role' THEN
    ALTER TABLE public.tenant_users
      ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE public.tenant_users
      ALTER COLUMN role TYPE TEXT USING role::text;
    ALTER TABLE public.tenant_users
      ALTER COLUMN role SET DEFAULT 'operador';
  END IF;

  -- Remove quaisquer constraints CHECK antigas sobre a coluna role em tenant_users
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'tenant_users'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.tenant_users DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;

  -- Remove constraint CHECK antiga de role em public.profiles (caso exista)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    FOR v_con IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'profiles'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%role%'
    LOOP
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;
  END IF;
END $$;

-- 3. Normalizar eventuais aliases legados para o papel canônico 'chat_agent'
UPDATE public.tenant_users
SET role = 'chat_agent'
WHERE LOWER(TRIM(role)) IN ('chat_only', 'atendente_chat', 'atendente de chat');

-- 4. Adicionar constraint CHECK atualizada permitindo todos os perfis operacionais e administrativos
ALTER TABLE public.tenant_users
  DROP CONSTRAINT IF EXISTS tenant_users_role_check;

ALTER TABLE public.tenant_users
  ADD CONSTRAINT tenant_users_role_check CHECK (
    LOWER(TRIM(role)) IN (
      'owner',
      'admin',
      'matriz',
      'admin_matriz',
      'network_admin',
      'super_admin',
      'pharmacy_admin',
      'gerente',
      'operador',
      'balconista',
      'chat_agent',
      'entregador',
      'farmaceutico',
      'caixa',
      'vendedor'
    )
  );

-- 5. Função auxiliar SECURITY DEFINER para identificar perfis restritos (Atendente de Chat / Operador)
CREATE OR REPLACE FUNCTION public.is_restricted_chat_role()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Prioriza o papel persistido no banco (tenant_users)
  SELECT LOWER(TRIM(tu.role)) INTO v_role
  FROM public.tenant_users tu
  WHERE tu.supabase_user_id = v_uid
  LIMIT 1;

  -- Fallback para app_metadata protegido no JWT
  IF v_role IS NULL OR v_role = '' THEN
    v_role := LOWER(TRIM(COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '')));
  END IF;

  RETURN v_role IN (
    'chat_agent',
    'chat_only',
    'atendente_chat',
    'atendente de chat',
    'operador',
    'operator',
    'atendente',
    'balconista'
  );
END;
$$;

-- 6. Bloquear mutações diretas via Supabase client por perfis restritos (RLS RESTRICTIVE)
--    (Operações de chat como chat_conversations / chat_messages continuam liberadas normalmente)

-- 6a. Tabela public.tenant_users (impede atendente/operador de editar ou criar usuários)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant_users') THEN
    DROP POLICY IF EXISTS "Block restricted chat roles insert tenant_users" ON public.tenant_users;
    DROP POLICY IF EXISTS "Block restricted chat roles update tenant_users" ON public.tenant_users;
    DROP POLICY IF EXISTS "Block restricted chat roles delete tenant_users" ON public.tenant_users;

    CREATE POLICY "Block restricted chat roles insert tenant_users"
      ON public.tenant_users AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles update tenant_users"
      ON public.tenant_users AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (NOT public.is_restricted_chat_role())
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles delete tenant_users"
      ON public.tenant_users AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (NOT public.is_restricted_chat_role());
  END IF;
END $$;

-- 6b. Tabela public.inboxes (impede criação/edição/exclusão de caixas de entrada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inboxes') THEN
    DROP POLICY IF EXISTS "Block restricted chat roles insert inboxes" ON public.inboxes;
    DROP POLICY IF EXISTS "Block restricted chat roles update inboxes" ON public.inboxes;
    DROP POLICY IF EXISTS "Block restricted chat roles delete inboxes" ON public.inboxes;

    CREATE POLICY "Block restricted chat roles insert inboxes"
      ON public.inboxes AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles update inboxes"
      ON public.inboxes AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (NOT public.is_restricted_chat_role())
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles delete inboxes"
      ON public.inboxes AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (NOT public.is_restricted_chat_role());
  END IF;
END $$;

-- 6c. Tabela public.whatsapp_instances (impede manipulação de instâncias WhatsApp)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'whatsapp_instances') THEN
    DROP POLICY IF EXISTS "Block restricted chat roles insert whatsapp_instances" ON public.whatsapp_instances;
    DROP POLICY IF EXISTS "Block restricted chat roles update whatsapp_instances" ON public.whatsapp_instances;
    DROP POLICY IF EXISTS "Block restricted chat roles delete whatsapp_instances" ON public.whatsapp_instances;

    CREATE POLICY "Block restricted chat roles insert whatsapp_instances"
      ON public.whatsapp_instances AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles update whatsapp_instances"
      ON public.whatsapp_instances AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (NOT public.is_restricted_chat_role())
      WITH CHECK (NOT public.is_restricted_chat_role());

    CREATE POLICY "Block restricted chat roles delete whatsapp_instances"
      ON public.whatsapp_instances AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (NOT public.is_restricted_chat_role());
  END IF;
END $$;
