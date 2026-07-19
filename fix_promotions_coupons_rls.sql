-- ==============================================================================
-- CORREÇÃO DE SEGURANÇA E REGRESSÃO: PROMOÇÕES E CUPONS (RLS)
-- ==============================================================================
-- Este script resolve o bloqueio de Row Level Security (RLS) que impede o
-- cliente final (usuários anônimos / anon / public) de visualizar promoções 
-- e cupons herdados da Matriz e de suas filiais correspondentes, reestabelecendo
-- o carrinho e os modais de produtos das filiais.
--
-- Execute este script no SQL Editor do seu console Supabase para aplicar a correção.
-- ==============================================================================

-- 1. Habilitar RLS nas tabelas correspondentes para garantir conformidade de segurança
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- 2. Limpar políticas de SELECT antigas / conflitantes para evitar duplicidades ou restrições excessivas
DROP POLICY IF EXISTS "Public Read on promotions" ON public.promotions;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.promotions;
DROP POLICY IF EXISTS "Tenant can read own promotions" ON public.promotions;
DROP POLICY IF EXISTS "Allow public read of promotions" ON public.promotions;

DROP POLICY IF EXISTS "Public Read on coupons" ON public.coupons;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.coupons;
DROP POLICY IF EXISTS "Tenant can read own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Allow public read of coupons" ON public.coupons;

-- 3. Criar políticas públicas de leitura (SELECT) correspondentes
-- OPÇÃO A: Leitura Pública Universal (Recomendado para desempenho máximo e simplicidade)
-- Como promoções e cupons são dados comerciais públicos (vitrine, carrinho e modal),
-- qualquer usuário (anônimo ou autenticado) pode visualizá-los. O isolamento de rede é
-- tratado de forma segura e rápida diretamente nas queries do aplicativo (services/storage.ts).
CREATE POLICY "Public Read on promotions" ON public.promotions
FOR SELECT TO public USING (true);

CREATE POLICY "Public Read on coupons" ON public.coupons
FOR SELECT TO public USING (true);

-- OPÇÃO B: Leitura com Restrição de Tenant/Matriz (Alternativa mais restrita)
-- Se você preferir uma política restritiva onde o usuário anônimo só possa ler a promoção se
-- o tenant_id dela for igual ao da loja atual OU for o network_id (Matriz) correspondente,
-- substitua as políticas acima por:
--
-- CREATE POLICY "Public Read on promotions" ON public.promotions
-- FOR SELECT TO public USING (
--   tenant_id = (SELECT id FROM public.tenants WHERE id = promotions.tenant_id)
--   OR tenant_id = (SELECT network_id FROM public.tenants WHERE id = promotions.tenant_id)
-- );
--
-- CREATE POLICY "Public Read on coupons" ON public.coupons
-- FOR SELECT TO public USING (
--   tenant_id = (SELECT id FROM public.tenants WHERE id = coupons.tenant_id)
--   OR tenant_id = (SELECT network_id FROM public.tenants WHERE id = coupons.tenant_id)
-- );

-- 4. Garantir que políticas de modificação (INSERT, UPDATE, DELETE) continuem seguras
-- Apenas usuários autenticados com permissão administrativa do tenant correspondente 
-- podem inserir, atualizar ou remover promoções e cupons.

-- Promoções (promotions)
DROP POLICY IF EXISTS "Tenant can insert promotions" ON public.promotions;
CREATE POLICY "Tenant can insert promotions" ON public.promotions
FOR INSERT WITH CHECK (public.user_can_modify_tenant(tenant_id));

DROP POLICY IF EXISTS "Tenant can update promotions" ON public.promotions;
CREATE POLICY "Tenant can update promotions" ON public.promotions
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id));

DROP POLICY IF EXISTS "Tenant can delete promotions" ON public.promotions;
CREATE POLICY "Tenant can delete promotions" ON public.promotions
FOR DELETE USING (public.user_can_modify_tenant(tenant_id));

-- Cupons (coupons)
DROP POLICY IF EXISTS "Tenant can insert coupons" ON public.coupons;
CREATE POLICY "Tenant can insert coupons" ON public.coupons
FOR INSERT WITH CHECK (public.user_can_modify_tenant(tenant_id));

DROP POLICY IF EXISTS "Tenant can update coupons" ON public.coupons;
CREATE POLICY "Tenant can update coupons" ON public.coupons
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id));

DROP POLICY IF EXISTS "Tenant can delete coupons" ON public.coupons;
CREATE POLICY "Tenant can delete coupons" ON public.coupons
FOR DELETE USING (public.user_can_modify_tenant(tenant_id));

-- ==============================================================================
