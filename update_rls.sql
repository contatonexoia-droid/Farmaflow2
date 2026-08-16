CREATE OR REPLACE FUNCTION public.user_can_modify_tenant(target_tenant_id text)
RETURNS boolean AS $$
DECLARE
  v_user_uid uuid;
  v_user_email text;
  v_target_network_id text;
BEGIN
  v_user_uid := auth.uid();
  IF v_user_uid IS NULL THEN
    RETURN false;
  END IF;

  v_user_email := auth.jwt()->>'email';
  IF v_user_email IN ('contato.nexoia@gmail.com', 'admin@drogaria.com') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE supabase_user_id = v_user_uid AND tenant_id = target_tenant_id
  ) THEN
    RETURN true;
  END IF;

  IF target_tenant_id = v_user_uid::text THEN
    RETURN true;
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_network_master()
RETURNS boolean AS $$
DECLARE
  v_user_uid uuid;
  v_user_email text;
BEGIN
  v_user_uid := auth.uid();
  IF v_user_uid IS NULL THEN
    RETURN false;
  END IF;

  v_user_email := auth.jwt()->>'email';
  IF v_user_email IN ('contato.nexoia@gmail.com', 'admin@drogaria.com') THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 
    FROM public.tenant_users tu
    JOIN public.tenants t ON tu.tenant_id = t.id
    WHERE tu.supabase_user_id = v_user_uid
      AND t.is_network_master = true
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE id = v_user_uid::text
      AND is_network_master = true
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
