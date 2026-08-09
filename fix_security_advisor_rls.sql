-- ==============================================================================
-- CORREÇÃO DE SEGURANÇA SUPABASE SECURITY ADVISOR (RLS)
-- ==============================================================================
-- Este script corrige os alertas críticos de segurança nas tabelas:
--   1. public.coupons
--   2. public.tenant_payment_gateways
--   3. public.tenant_users
--
-- MOTIVO DA VULNERABILIDADE:
-- Políticas anteriores utilizavam `auth.jwt() -> 'user_metadata'`, permitindo que
-- usuários mal-intencionados alterassem seus próprios metadados no lado do cliente
-- para forjar o `tenant_id` e acessar dados de outras farmácias/lojas.
--
-- SOLUÇÃO:
-- Substituição por validação relacional segura via tabela `public.tenant_users`
-- e claims protegidas do servidor (`app_metadata`), encapsuladas em função
-- SECURITY DEFINER imune a edições no frontend.
--
-- INSTRUÇÕES DE EXECUÇÃO:
-- Copie e cole este script no SQL Editor do seu Painel do Supabase e clique em "Run".
-- ==============================================================================

-- 1. Função Auxiliar de Verificação Segura de Membro do Tenant (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_tenant_member(target_tenant_id text)
RETURNS boolean AS $$
DECLARE
  v_user_uid uuid;
  v_target_network_id text;
BEGIN
  v_user_uid := auth.uid();
  IF v_user_uid IS NULL THEN
    RETURN false;
  END IF;

  -- A. Proprietário direto cujo ID do tenant coincide com o UUID de autenticação
  IF target_tenant_id = v_user_uid::text THEN
    RETURN true;
  END IF;

  -- B. Claim segura de app_metadata (gerenciada exclusivamente pelo backend/servidor)
  IF (auth.jwt() -> 'app_metadata' ->> 'tenant_id') = target_tenant_id THEN
    RETURN true;
  END IF;

  -- C. Associação relacional na tabela tenant_users
  IF EXISTS (
    SELECT 1 
    FROM public.tenant_users
    WHERE supabase_user_id = v_user_uid 
      AND tenant_id = target_tenant_id
  ) THEN
    RETURN true;
  END IF;

  -- D. Permissão de Matriz / Rede Master (se aplicável)
  SELECT network_id INTO v_target_network_id FROM public.tenants WHERE id = target_tenant_id;
  IF v_target_network_id IS NOT NULL AND v_target_network_id != '' THEN
    IF EXISTS (
      SELECT 1 
      FROM public.tenant_users tu
      JOIN public.tenants t ON tu.tenant_id = t.id
      WHERE tu.supabase_user_id = v_user_uid
        AND t.is_network_master = true
        AND t.network_id = v_target_network_id
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Alias para compatibilidade com outras funções do sistema
CREATE OR REPLACE FUNCTION public.user_can_modify_tenant(target_tenant_id text)
RETURNS boolean AS $$
BEGIN
  RETURN public.is_tenant_member(target_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Limpeza dinâmica de políticas antigas/inseguras nas 3 tabelas afetadas
DO $$ 
DECLARE 
  pol record;
BEGIN
  FOR pol IN 
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename IN ('coupons', 'tenant_payment_gateways', 'tenant_users')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;


-- ==============================================================================
-- 3. TABELA: public.coupons (Cupons)
-- ==============================================================================
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Leitura pública: necessária para que compradores/clientes possam aplicar cupons no carrinho
CREATE POLICY "Public Read on coupons" 
ON public.coupons FOR SELECT 
TO public 
USING (true);

-- Inserção, Atualização e Exclusão restritas a membros autorizados do tenant
CREATE POLICY "Tenant members can insert coupons" 
ON public.coupons FOR INSERT 
TO authenticated 
WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can update coupons" 
ON public.coupons FOR UPDATE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can delete coupons" 
ON public.coupons FOR DELETE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));


-- ==============================================================================
-- 4. TABELA: public.tenant_payment_gateways (Gateways de Pagamento)
-- ==============================================================================
ALTER TABLE public.tenant_payment_gateways ENABLE ROW LEVEL SECURITY;

-- Acesso total (chaves de API, credenciais e ativação) protegido exclusivamente para o tenant
CREATE POLICY "Tenant members can view payment gateways" 
ON public.tenant_payment_gateways FOR SELECT 
TO authenticated 
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can insert payment gateways" 
ON public.tenant_payment_gateways FOR INSERT 
TO authenticated 
WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can update payment gateways" 
ON public.tenant_payment_gateways FOR UPDATE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can delete payment gateways" 
ON public.tenant_payment_gateways FOR DELETE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));


-- ==============================================================================
-- 5. TABELA: public.tenant_users (Usuários e Equipes da Loja)
-- ==============================================================================
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- Visualização permitida se o usuário for ele mesmo ou membro da equipe do tenant
CREATE POLICY "Tenant members can view team" 
ON public.tenant_users FOR SELECT 
TO authenticated 
USING (
  supabase_user_id = auth.uid() OR public.is_tenant_member(tenant_id)
);

-- Gerenciamento de equipe (adicionar, editar papel, remover) restrito aos membros autorizados
CREATE POLICY "Tenant members can insert team" 
ON public.tenant_users FOR INSERT 
TO authenticated 
WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can update team" 
ON public.tenant_users FOR UPDATE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can delete team" 
ON public.tenant_users FOR DELETE 
TO authenticated 
USING (public.is_tenant_member(tenant_id));

-- ==============================================================================
-- FIM DO SCRIPT
-- ==============================================================================
