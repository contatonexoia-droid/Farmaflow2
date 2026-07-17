-- SQL para remover a restrição de unicidade do código de barras por filial (tenant)
-- Isso evita erros de chave duplicada (duplicate key value violates unique constraint)
-- ao importar produtos que possuem códigos de barras vazios, repetidos ou provisórios.

ALTER TABLE public.products 
DROP CONSTRAINT IF EXISTS unique_product_barcode_per_tenant;

-- Opcional: Criar um índice não-único para manter a busca por código de barras rápida e otimizada
CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode 
ON public.products (tenant_id, barcode);
