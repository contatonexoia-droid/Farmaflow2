DO $$ 
DECLARE 
  pol record;
BEGIN
  FOR pol IN 
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' AND tablename IN ('products', 'promotions', 'orders', 'integration_logs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Refatoração de Segurança RLS (Sem quebrar a lógica Multi-Tenant de Rede)

-- 1. Funções Auxiliares para verificar permissões de rede/matriz
CREATE OR REPLACE FUNCTION public.user_can_modify_tenant(target_tenant_id text)
RETURNS boolean AS $$
DECLARE
  v_user_uid uuid;
  v_user_tenant_id text;
  v_is_network_master boolean;
  v_user_network_id text;
  v_target_network_id text;
BEGIN
  v_user_uid := auth.uid();
  IF v_user_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT tu.tenant_id, t.is_network_master, t.network_id
  INTO v_user_tenant_id, v_is_network_master, v_user_network_id
  FROM public.tenant_users tu
  JOIN public.tenants t ON tu.tenant_id = t.id
  WHERE tu.supabase_user_id = v_user_uid
  LIMIT 1;

  IF v_user_tenant_id IS NULL THEN
    SELECT id, is_network_master, network_id
    INTO v_user_tenant_id, v_is_network_master, v_user_network_id
    FROM public.tenants
    WHERE id = v_user_uid::text
    LIMIT 1;
  END IF;

  IF v_user_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF target_tenant_id = v_user_tenant_id THEN
    RETURN true;
  END IF;

  IF v_is_network_master = true AND v_user_network_id IS NOT NULL THEN
    SELECT network_id INTO v_target_network_id FROM public.tenants WHERE id = target_tenant_id;
    IF v_target_network_id = v_user_network_id THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_network_master()
RETURNS boolean AS $$
DECLARE
  v_user_uid uuid;
  v_is_network_master boolean;
BEGIN
  v_user_uid := auth.uid();
  IF v_user_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT t.is_network_master
  INTO v_is_network_master
  FROM public.tenant_users tu
  JOIN public.tenants t ON tu.tenant_id = t.id
  WHERE tu.supabase_user_id = v_user_uid
  LIMIT 1;

  IF v_is_network_master IS NULL THEN
    SELECT is_network_master
    INTO v_is_network_master
    FROM public.tenants
    WHERE id = v_user_uid::text
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_is_network_master, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Produtos (products)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read on products" ON public.products
FOR SELECT USING (true);

CREATE POLICY "Tenant can insert products" ON public.products
FOR INSERT WITH CHECK (public.user_can_modify_tenant(tenant_id));

CREATE POLICY "Tenant can update products" ON public.products
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id));

CREATE POLICY "Tenant can delete products" ON public.products
FOR DELETE USING (public.user_can_modify_tenant(tenant_id));


-- 3. Promoções (promotions)
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read on promotions" ON public.promotions
FOR SELECT USING (true);

CREATE POLICY "Tenant can insert promotions" ON public.promotions
FOR INSERT WITH CHECK (public.user_can_modify_tenant(tenant_id));

CREATE POLICY "Tenant can update promotions" ON public.promotions
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id));

CREATE POLICY "Tenant can delete promotions" ON public.promotions
FOR DELETE USING (public.user_can_modify_tenant(tenant_id));


-- 4. Pedidos (orders)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can read own orders" ON public.orders
FOR SELECT USING (public.user_can_modify_tenant(tenant_id));

-- Clientes do aplicativo (muitas vezes anônimos) precisam poder finalizar pedidos
CREATE POLICY "Public can insert orders" ON public.orders
FOR INSERT WITH CHECK (true);

CREATE POLICY "Tenant can update orders" ON public.orders
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id));

CREATE POLICY "Tenant can delete orders" ON public.orders
FOR DELETE USING (public.user_can_modify_tenant(tenant_id));


-- 5. Logs de Integração (integration_logs)
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Network can read integration logs" ON public.integration_logs
FOR SELECT USING (public.user_can_modify_tenant(tenant_id));

-- Apenas a Matriz (ou serviços internos via Service Role) pode gravar logs
CREATE POLICY "Matrix can insert integration logs" ON public.integration_logs
FOR INSERT WITH CHECK (public.user_can_modify_tenant(tenant_id) AND public.is_network_master());

CREATE POLICY "Matrix can update integration logs" ON public.integration_logs
FOR UPDATE USING (public.user_can_modify_tenant(tenant_id) AND public.is_network_master());

CREATE POLICY "Matrix can delete integration logs" ON public.integration_logs
FOR DELETE USING (public.user_can_modify_tenant(tenant_id) AND public.is_network_master());
