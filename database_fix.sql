-- ==============================================================================
-- CORREÇÃO DE PERMISSÕES PARA O SUPER ADMIN (RLS BYPASS)
-- ==============================================================================
-- O erro "permission denied for table tenants" ocorre porque a política de nível
-- de linha (RLS) bloqueia atualizações em registros se não for o dono ou se houver
-- regras estritas de isolamento.
--
-- Execute os comandos abaixo no SQL Editor do seu Supabase.

-- 1. Garante os privilégios base para as roles padrão do Supabase
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenants TO service_role;

-- 2. Políticas de RLS para a tabela 'tenants'
-- OBS: Adapte o "USING (true)" caso já tenha uma claim JWT específica para o Super Admin
-- (ex: USING (auth.jwt() ->> 'role' = 'super_admin')). O padrão abaixo libera totalmente
-- a edição se o usuário estiver autenticado no painel administrativo.

-- Política Universal de SELECT (para carregar os dados reais nos campos)
DROP POLICY IF EXISTS "Enable read access for super admins" ON public.tenants;
CREATE POLICY "Enable read access for super admins"
ON public.tenants
FOR SELECT TO authenticated
USING (true);

-- Política Universal de UPDATE (para salvar edições e senhas)
DROP POLICY IF EXISTS "Enable update access for super admins" ON public.tenants;
CREATE POLICY "Enable update access for super admins"
ON public.tenants
FOR UPDATE TO authenticated
USING (true);

-- Política Universal de INSERT (para criar novas empresas)
DROP POLICY IF EXISTS "Enable insert access for super admins" ON public.tenants;
CREATE POLICY "Enable insert access for super admins"
ON public.tenants
FOR INSERT TO authenticated
WITH CHECK (true);

-- ==============================================================================
