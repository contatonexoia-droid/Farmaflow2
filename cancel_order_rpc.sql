CREATE OR REPLACE FUNCTION cancel_order_with_stock_rollback(
  p_tenant_id UUID,
  p_order_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_status TEXT;
  v_order_items JSONB;
  v_item JSONB;
  v_product_id TEXT;
  v_quantity INT;
BEGIN
  -- Verificar status atual e obter itens do pedido
  SELECT status, items INTO v_order_status, v_order_items
  FROM orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id
  FOR UPDATE; -- Lock na linha para evitar concorrência

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF v_order_status = 'cancelled' THEN
    RAISE EXCEPTION 'Pedido já está cancelado';
  END IF;

  -- Atualizar status do pedido para cancelled
  UPDATE orders
  SET status = 'cancelled'
  WHERE id = p_order_id AND tenant_id = p_tenant_id;

  -- Restaurar estoque
  IF v_order_items IS NOT NULL AND jsonb_typeof(v_order_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_order_items)
    LOOP
      v_product_id := v_item->>'id';
      v_quantity := (v_item->>'quantity')::INT;

      IF v_product_id IS NOT NULL AND v_quantity > 0 THEN
        UPDATE products
        SET stock = stock + v_quantity
        WHERE id = v_product_id AND tenant_id = p_tenant_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Pedido cancelado e estoque restaurado com sucesso');
EXCEPTION WHEN OTHERS THEN
  -- Em caso de qualquer erro, o transaction block da function (no postgres plpgsql funções em chamadas únicas rodam em transação) dará rollback automático
  RAISE EXCEPTION 'Erro ao cancelar pedido: %', SQLERRM;
END;
$$;
