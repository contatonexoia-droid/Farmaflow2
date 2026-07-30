CREATE OR REPLACE FUNCTION get_store_offers(p_tenant_id TEXT, p_network_id TEXT DEFAULT NULL)
RETURNS SETOF promotions
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM promotions 
  WHERE tenant_id = p_tenant_id OR (p_network_id IS NOT NULL AND tenant_id = p_network_id);
$$;
