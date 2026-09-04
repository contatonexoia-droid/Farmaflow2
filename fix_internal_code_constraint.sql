-- SQL para remover a restrição de unicidade do código interno por filial (tenant)
-- No FarmaFlow, o identificador único absoluto do produto é o EAN (Código de Barras).
-- Planilhas de fornecedores, distribuidores ou referências distintas podem reutilizar
-- o mesmo código interno para produtos completamente diferentes.

ALTER TABLE public.products 
DROP CONSTRAINT IF EXISTS unique_product_internal_code_per_tenant;

-- Cria um índice comum (não-único) para buscas e filtros rápidos por código interno
CREATE INDEX IF NOT EXISTS idx_products_tenant_internal_code 
ON public.products (tenant_id, internal_code);
