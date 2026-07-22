-- Script de atualização da tabela promotions para suporte a Combos / Bundles

-- 1. Garante a existência das colunas bundle_slots e bundle_price na tabela promotions
ALTER TABLE IF EXISTS public.promotions
ADD COLUMN IF NOT EXISTS bundle_slots JSONB,
ADD COLUMN IF NOT EXISTS bundle_price NUMERIC;

-- 2. Migra/Repara os combos antigos salvos anteriormente em filters_metadata
UPDATE public.promotions
SET 
  bundle_slots = COALESCE(
    bundle_slots, 
    filters_metadata->'bundleSlots', 
    filters_metadata->'bundle_slots', 
    filters_metadata->'slots'
  ),
  bundle_price = COALESCE(
    bundle_price, 
    NULLIF(filters_metadata->>'bundlePrice', '')::numeric, 
    NULLIF(filters_metadata->>'bundle_price', '')::numeric
  )
WHERE 
  (bundle_slots IS NULL AND (filters_metadata->'bundleSlots' IS NOT NULL OR filters_metadata->'bundle_slots' IS NOT NULL))
  OR (bundle_price IS NULL AND (filters_metadata->'bundlePrice' IS NOT NULL OR filters_metadata->'bundle_price' IS NOT NULL));

-- 3. Atualiza specific_product_ids com os IDs extraídos dos slots ou filters_metadata caso estejam vazios
UPDATE public.promotions p
SET specific_product_ids = (
  SELECT COALESCE(array_agg(DISTINCT id_val), '{}'::text[])
  FROM (
    SELECT jsonb_array_elements_text(p.filters_metadata->'product_ids') AS id_val
    WHERE jsonb_typeof(p.filters_metadata->'product_ids') = 'array'
    UNION ALL
    SELECT jsonb_array_elements_text(p.filters_metadata->'specificProductIds') AS id_val
    WHERE jsonb_typeof(p.filters_metadata->'specificProductIds') = 'array'
    UNION ALL
    SELECT jsonb_array_elements_text(p.filters_metadata->'productIds') AS id_val
    WHERE jsonb_typeof(p.filters_metadata->'productIds') = 'array'
    UNION ALL
    SELECT jsonb_array_elements_text(p.combo_products) AS id_val
    WHERE jsonb_typeof(p.combo_products) = 'array'
  ) sub
  WHERE id_val IS NOT NULL AND id_val != ''
)
WHERE (p.specific_product_ids IS NULL OR cardinality(p.specific_product_ids) = 0)
  AND (p.filters_metadata IS NOT NULL OR p.combo_products IS NOT NULL);
